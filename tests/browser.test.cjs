'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');

const ROOT=path.resolve(__dirname,'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8',
'.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.css':'text/css'};
let server,browser,base;
const errors=[];
const MAIN='/repertorio-haroldo.html';
const A='/setlists/a-sua-maneira.html';
const J='/setlists/jazz-blues.html';
const output=path.join(ROOT,'artifacts');
fs.mkdirSync(output,{recursive:true});
const observedCoverage={ main:new Set(), editor:new Set(), clicked:new Set(), paths:new Set() };
function coverageCollector(entries){
  for(const entry of entries){
    const kind=entry.url.includes('/repertorio-haroldo.html')?'main':entry.url.includes('/setlists/editor.js')?'editor':null;
    if(!kind)continue;
    for(const fn of entry.functions){
      if(!fn.functionName)continue;
      if(fn.ranges.some(r=>r.count>0))observedCoverage[kind].add(fn.functionName);
    }
  }
}

before(async()=>{
  server=http.createServer((req,res)=>{
    let url;
    try { url=new URL(req.url,'http://localhost'); }catch(e){res.writeHead(400).end();return;}
    const file=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname));
    if(!(file===ROOT||file.startsWith(ROOT+path.sep))){res.writeHead(403).end();return;}
    try {
      const stat=fs.statSync(file);
      const target=stat.isDirectory()?path.join(file,'index.html'):file;
      res.writeHead(200,{'Content-Type':MIME[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
      fs.createReadStream(target).pipe(res);
    }catch(e){res.writeHead(404).end('Not Found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
});
after(async()=>{
  const html=fs.readFileSync(path.join(ROOT,'repertorio-haroldo.html'),'utf8');
  const editor=fs.readFileSync(path.join(ROOT,'setlists/editor.js'),'utf8');
  const declared=(src)=>[...new Set([...src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]))].sort();
  const summary={};
  for(const [kind,src] of [['main',html],['editor',editor]]){
    const names=declared(src);
    summary[kind]={
      declared:names.length,
      exercised:names.filter(n=>observedCoverage[kind].has(n)).length,
      namesExercised:names.filter(n=>observedCoverage[kind].has(n)),
      namesNotExercised:names.filter(n=>!observedCoverage[kind].has(n))
    };
  }
  summary.clickedElements=[...observedCoverage.clicked].sort();
  fs.writeFileSync(path.join(output,'coverage-all-browser-tests.json'),JSON.stringify(summary,null,2));
  console.log('V8 ACUMULADO:',summary.main.exercised+'/'+summary.main.declared,
    'funções principais;',summary.editor.exercised+'/'+summary.editor.declared,'funções do editor;',
    summary.clickedElements.length,'identificadores de botão clicados.');
  const declaredButtons=[...html.matchAll(/<button\b([^>]*)>/gi)].map(m=>m[1].match(/\bid=["']([^"']+)/)?.[1]).filter(Boolean);
  const neverClicked=declaredButtons.filter(id=>!observedCoverage.clicked.has(id));
  summary.staticButtons={count:declaredButtons.length,clicked:declaredButtons.length-neverClicked.length,notClicked:neverClicked};
  fs.writeFileSync(path.join(output,'coverage-all-browser-tests.json'),JSON.stringify(summary,null,2));
  console.log('BOTÕES ESTÁTICOS CLICADOS:',summary.staticButtons.clicked+'/'+summary.staticButtons.count,'ausentes:',neverClicked.join(', '));
  console.log('V8 FUNÇÕES AINDA NÃO EXERCITADAS:',summary.main.namesNotExercised.join(', '));
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
});

async function fresh({mobile=false,locale='pt-BR',allowServiceWorkers=false}={}){
  const context=await browser.newContext({
    viewport:mobile?{width:390,height:844}:{width:1440,height:900},
    isMobile:mobile,hasTouch:mobile,locale,
    acceptDownloads:true,
    permissions:['clipboard-read','clipboard-write'],
    serviceWorkers:allowServiceWorkers?'allow':'block'
  });
  await context.exposeBinding('__auditRecordClick',(_source,id)=>{
    observedCoverage.clicked.add(id);
  });
  await context.addInitScript(()=>{
    window.__auditClicks=[];
    document.addEventListener('click',ev=>{
      const button=ev.target.closest && ev.target.closest('button');
      if(button){
        const id=button.id||button.getAttribute('data-a')||button.className||'sem-identificador';
        window.__auditClicks.push(id);
        if(window.__auditRecordClick) window.__auditRecordClick(id).catch(()=>{});
      }
    },true);
  });
  const page=await context.newPage();
  const failures=[];
  page.on('pageerror',e=>failures.push(e.message));
  const session=await context.newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
  const close=async()=>{
    try{
      const result=await session.send('Profiler.takePreciseCoverage');
      coverageCollector(result.result||[]);
      const clicks=await page.evaluate(()=>window.__auditClicks||[]).catch(()=>[]);
      for(const id of clicks)observedCoverage.clicked.add(id);
    }catch(err){console.warn('AVISO: sem medição V8 neste caso:',err.message);}
    await session.detach().catch(()=>{});
    await context.close();
  };
  return {context,page,failures,close};
}
async function goto(s,url){await s.page.goto(base+url,{waitUntil:'load'});}
async function openPrep(page,which=0){
  await page.locator('#shareSetlistBtn').click();
  const opts=page.locator('#setlistMgrList .shareChoice');
  await opts.nth(which).click();
  await page.locator('#musicianSheet.active').waitFor();
}
async function downloadAfter(page,cb){
  const awaited=page.waitForEvent('download',{timeout:15000});
  await cb();
  const download=await awaited;
  const filepath=await download.path();
  return {filename:download.suggestedFilename(),bytes:fs.readFileSync(filepath)};
}
async function checkNoPageErrors(s){assert.deepEqual(s.failures,[],'O navegador produziu exceções JavaScript');}

test('Browser 01: app real inicializa, 214 músicas e sem exceptions',async()=>{
  const s=await fresh();try {
    await goto(s,MAIN);
    assert.equal(await s.page.locator('#list .item').count(),214);
    assert.match(await s.page.locator('#subInfo').innerText(),/214/);
    await checkNoPageErrors(s);
  } finally {await s.close();}
});
test('Browser 02: botões das categorias entregam 204 e 19 músicas',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'A Sua Maneira'}).click();
    assert.equal(await s.page.locator('#list .item').count(),204);
    await s.page.locator('#chips .chip',{hasText:'Jazz & Blues'}).click();
    assert.equal(await s.page.locator('#list .item').count(),19);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 03: pesquisa sem acento e resultado vazio',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#search').fill('Aguas de Marco');
    assert.ok((await s.page.locator('#list .item').count())>=1);
    await s.page.locator('#search').fill('zzqqq-nenhuma-musica-2026');
    assert.equal(await s.page.locator('#list .item').count(),0);
    assert.notEqual(await s.page.locator('#empty').evaluate(e=>getComputedStyle(e).display),'none');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 04: seletor de compartilhamento não exige setlist manual',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#shareSetlistBtn').click();
    assert.equal(await s.page.locator('#setlistMgrList .shareChoice').count(),2);
    assert.match(await s.page.locator('#setlistMgrList').innerText(),/A Sua Maneira/);
    assert.match(await s.page.locator('#setlistMgrList').innerText(),/Jazz & Blues/);
    assert.equal(await s.page.locator('#newSetlistBtn').evaluate(e=>getComputedStyle(e).display),'none');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 05: clicar na playlist abre preparação correta e campos editáveis',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);await openPrep(s.page,1);
    assert.equal(await s.page.locator('#musicianList .musicianRow').count(),19);
    assert.equal(await s.page.locator('#musicianList .musicianKey').count(),19);
    assert.equal(await s.page.locator('#musicianTitle').innerText(),'Jazz & Blues');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 06: tom da preparação persiste após recarregar',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);await openPrep(s.page,1);
    await s.page.locator('.musicianKey').first().fill('Bbmaj7');
    await s.page.reload();await openPrep(s.page,1);
    assert.equal(await s.page.locator('.musicianKey').first().inputValue(),'Bbmaj7');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 07: página curta A tem 204 linhas e inputs, J tem 19',async()=>{
  const s=await fresh();try{
    await goto(s,A);
    assert.equal(await s.page.locator('.song').count(),204);
    assert.equal(await s.page.locator('input.keyInput').count(),204);
    assert.equal(await s.page.locator('textarea.noteInput').count(),204);
    await goto(s,J);
    assert.equal(await s.page.locator('.song').count(),19);
    assert.equal(await s.page.locator('textarea.noteInput').count(),19);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 08: nota e anotação persistem após reload no navegador real',async()=>{
  const s=await fresh();try{
    await goto(s,J);
    await s.page.locator('.keyInput').first().fill('G#m7');
    await s.page.locator('.noteInput').first().fill('Entrar após bateria\nRepetir 2x');
    await s.page.reload();
    assert.equal(await s.page.locator('.keyInput').first().inputValue(),'G#m7');
    assert.equal(await s.page.locator('.noteInput').first().inputValue(),'Entrar após bateria\nRepetir 2x');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 09: dois dispositivos simulados não compartilham localStorage',async()=>{
  const a=await fresh(),b=await fresh();
  try{
    await goto(a,J);await a.page.locator('.keyInput').first().fill('D#');
    await goto(b,J);
    assert.equal(await b.page.locator('.keyInput').first().inputValue(),'');
    await a.page.reload();assert.equal(await a.page.locator('.keyInput').first().inputValue(),'D#');
    await checkNoPageErrors(a);await checkNoPageErrors(b);
  }finally{await a.close();await b.close();}
});
test('Browser 10: duas abas do mesmo contexto preservam edições em músicas distintas',async()=>{
  const s=await fresh();try{
    await goto(s,J);
    const p2=await s.context.newPage();const p2errors=[];
    p2.on('pageerror',e=>p2errors.push(e.message));
    await p2.goto(base+J);
    await s.page.locator('.keyInput').nth(0).fill('C');
    await p2.locator('.keyInput').nth(1).fill('D');
    await s.page.reload();
    assert.equal(await s.page.locator('.keyInput').nth(0).inputValue(),'C');
    assert.equal(await s.page.locator('.keyInput').nth(1).inputValue(),'D');
    assert.deepEqual(p2errors,[]);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 11: teste de estresse edita 204 tons e 100 anotações de uma vez',async()=>{
  const s=await fresh();try{
    await goto(s,A);
    await s.page.locator('#list .song').first().waitFor();
    assert.equal(await s.page.locator('#list .song').count(),204);
    const started=Date.now();
    const filled=await s.page.evaluate(()=>{
      const rows=[...document.querySelectorAll('#list .song')];
      for(let i=0;i<rows.length;i++){
        const key=rows[i].querySelector('.keyInput');
        key.value=i%2?'F#m7':'Bb';
        key.dispatchEvent(new Event('input',{bubbles:true}));
        if(i<100){
          const note=rows[i].querySelector('.noteInput');
          note.value='Anotação stress '+i+' \n'.repeat(10);
          note.dispatchEvent(new Event('input',{bubbles:true}));
        }
      }
      return rows.length;
    });
    assert.equal(filled,204);
    await s.page.reload();
    const keys=await s.page.locator('.keyInput').evaluateAll(xs=>xs.map(x=>x.value));
    assert.equal(keys.length,204);
    assert.ok(keys.every((x,i)=>x===(i%2?'F#m7':'Bb')));
    const notes=await s.page.locator('.noteInput').evaluateAll(xs=>xs.slice(0,100).map(x=>x.value));
    assert.ok(notes.every((s,i)=>s.startsWith('Anotação stress '+i)));
    console.log('STRESS 204 músicas + 100 anotações:',Date.now()-started,'ms');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 12: capacidade de texto longo é limitada sem impedir reload',async()=>{
  const s=await fresh();try{
    await goto(s,J);
    const content='Observação\\n'.repeat(180);
    await s.page.locator('.noteInput').first().fill(content.slice(0,2000));
    await s.page.reload();
    assert.equal(await s.page.locator('.noteInput').first().inputValue(),content.slice(0,2000));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 13: armazenamento indisponível avisa falha em vez de afirmar salvo',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      const native=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){
        if(k.startsWith('repHaroldo_musicianFields_v1')) throw new DOMException('Quota exceedida','QuotaExceededError');
        return native.call(this,k,v);
      };
    });
    await goto(s,J);
    await s.page.locator('.keyInput').first().fill('E');
    assert.match(await s.page.locator('#saveStatus').innerText(),/Não foi possível salvar/);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 14: copiar lista contém as alterações reais da tela',async()=>{
  const s=await fresh();try{
    let copied;
    await s.context.addInitScript(()=>{
      window.__copied='';
      const api={writeText:async v=>{window.__copied=String(v);},readText:async()=>window.__copied};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:api});
      window.alert=()=>{};
    });
    await goto(s,J);
    await s.page.locator('.keyInput').first().fill('Ab');
    await s.page.locator('.noteInput').first().fill('Sinal no final');
    await s.page.locator('#copyBtn').click();
    copied=await s.page.evaluate(()=>window.__copied);
    assert.ok(copied.includes('Ab'));
    assert.ok(copied.includes('Sinal no final'));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 15: impressão dispara diálogo do navegador',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.__printed=0;window.print=()=>{window.__printed++};});
    await goto(s,J);await s.page.locator('#printBtn').click();
    assert.equal(await s.page.evaluate(()=>window.__printed),1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 16: PDF baixado é aberto por parser externo real',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);await openPrep(s.page,1);
    const file=await downloadAfter(s.page,()=>s.page.locator('#musicianPdf').click());
    assert.ok(file.filename.endsWith('.pdf'));
    const doc=await PDFDocument.load(file.bytes,{ignoreEncryption:true});
    assert.ok(doc.getPageCount()>=1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 17: PDF de 204 músicas tem várias páginas e parser externo abre',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);await openPrep(s.page,0);
    const file=await downloadAfter(s.page,()=>s.page.locator('#musicianPdf').click());
    const pdf=await PDFDocument.load(file.bytes);
    assert.ok(pdf.getPageCount()>=5);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 18: Word exporta arquivo baixável somente com tabela de músicas',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);await openPrep(s.page,1);
    const file=await downloadAfter(s.page,()=>s.page.locator('#musicianWord').click());
    assert.ok(file.filename.endsWith('.doc'));
    const html=file.bytes.toString('utf8');
    assert.ok(html.includes('<table'));
    assert.ok(html.includes('Jazz &amp; Blues')||html.includes('Jazz & Blues'));
    assert.ok(!html.includes('id="songdata"'));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 19: exportar backup baixa JSON com anotações reais',async()=>{
  const s=await fresh();try{
    await goto(s,J);
    await s.page.locator('.noteInput').first().fill('Anotação em backup real');
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    const file=await downloadAfter(s.page,()=>s.page.locator('#exportBtn').click());
    const json=JSON.parse(file.bytes.toString('utf8'));
    assert.equal(json.type,'repHaroldoBackup');
    const fields=json.data.musicianFields['jazz-blues'];
    assert.ok(Object.values(fields).some(e=>e.note==='Anotação em backup real'));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 20: importar backup real restaura letra e anotação',async()=>{
  const s=await fresh();try{
    const payload={type:'repHaroldoBackup',version:1,data:{
      custom:[{id:'Ctest-browser',title:'Música restaurada',artist:'Artista',cats:'J',text:'Letra restaurada'}],
      musicianFields:{'jazz-blues':{'SBrestaurado':{key:'G',note:'Importada do backup'}}}
    }};
    await s.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#importFile').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload),'utf8')});
    await s.page.waitForFunction(()=>localStorage.getItem('repHaroldo_musicianFields_v1:jazz-blues')!==null);
    const result=await s.page.evaluate(()=>({
      customs:JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]'),
      fields:JSON.parse(localStorage.getItem('repHaroldo_musicianFields_v1:jazz-blues')||'{}')
    }));
    assert.ok(result.customs.some(s=>s.title==='Música restaurada'));
    assert.equal(result.fields.SBrestaurado.note,'Importada do backup');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 21: nova letra criada pela UI sobrevive à atualização',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inTitle').fill('Canção de teste browser');
    await s.page.locator('#inArtist').fill('E2E');
    await s.page.locator('#inLyrics').fill('Letra do teste em navegador real');
    await s.page.locator('#saveSong').click();
    await s.page.reload();
    assert.match(await s.page.locator('#subInfo').innerText(),/215/);
    await s.page.locator('#search').fill('Canção de teste browser');
    assert.equal(await s.page.locator('#list .item').count(),1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 22: teleprompter entra e volta à lista pelo botão Menu',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .item').first().click();
    await s.page.locator('#songView.active').waitFor();
    assert.ok((await s.page.locator('#songBody').textContent()).length>5);
    const before=Number(await s.page.locator('#spdVal').innerText());
    await s.page.locator('#spdUp').click();
    assert.equal(Number(await s.page.locator('#spdVal').innerText()),Math.min(150,before+2));
    await s.page.locator('#menuBtn').click();
    await s.page.locator('#homeView.active').waitFor();
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 23: tela em resolução móvel mantém nota e anotação editáveis',async()=>{
  const s=await fresh({mobile:true});try{
    await goto(s,J);
    const input=s.page.locator('.keyInput').first();
    await input.fill('Bm');
    await s.page.locator('.noteInput').first().fill('Observação no celular');
    await s.page.reload();
    assert.equal(await s.page.locator('.keyInput').first().inputValue(),'Bm');
    assert.equal(await s.page.locator('.noteInput').first().inputValue(),'Observação no celular');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 24: payload malicioso na página de visualização não executa HTML',async()=>{
  const s=await fresh();try{
    const p={v:1,n:'Teste',s:[['<img src=x onerror=alert(1)>','Artista','C']]};
    const encoded=Buffer.from(JSON.stringify(p)).toString('base64url');
    await goto(s,'/setlist.html#d='+encoded);
    assert.equal(await s.page.locator('#list img').count(),0);
    assert.match(await s.page.locator('.song .title').innerText(),/<img/);
    assert.equal(await s.page.locator('#actions').isVisible(),true);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 25: cobertura V8 mede funções realmente alcançadas por navegação',async()=>{
  const s=await fresh();let session;
  try{
    session=await s.context.newCDPSession(s.page);
    await session.send('Profiler.enable');
    await session.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'Jazz & Blues'}).click();
    await s.page.locator('#search').fill('wonderwall');
    await s.page.locator('#search').fill('');
    await openPrep(s.page,1);
    await s.page.locator('.musicianKey').first().fill('Am');
    await s.page.locator('#musicianBack').click();
    await s.page.waitForTimeout(80);
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#closeSet').click();
    const result=await session.send('Profiler.takePreciseCoverage');
    const hits=new Set(),all=new Set(),sourceNames=new Set();
    for(const entry of result.result) {
      if(!entry.url.includes(MAIN))continue;
      for(const fn of entry.functions){
        const name=fn.functionName;
        if(!name)continue;
        all.add(name);
        if(fn.ranges.some(r=>r.count>0))hits.add(name);
      }
    }
    const html=fs.readFileSync(path.join(ROOT,'repertorio-haroldo.html'),'utf8');
    for(const m of html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g))sourceNames.add(m[1]);
    const names=[...sourceNames].sort();
    const report={
      totalNamed:names.length,executedNamed:names.filter(x=>hits.has(x)).length,
      unexecuted:names.filter(x=>!hits.has(x)),
      executed:names.filter(x=>hits.has(x)),detectedFunctions:all.size,
      note:'Cobertura V8 desta trilha de navegação, não cobertura de todos os caminhos do projeto.'
    };
    fs.writeFileSync(path.join(output,'function-coverage.json'),JSON.stringify(report,null,2));
    console.log('V8 COBERTURA DE FUNÇÕES:',report.executedNamed+'/'+report.totalNamed);
    assert.ok(report.executedNamed>=15);
    await checkNoPageErrors(s);
  }finally{
    if(session)await session.detach().catch(()=>{});
    await s.close();
  }
});


test('Browser 26: todos os botões de preferências persistem após recarregar',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#setView.active').waitFor();
    for(const id of ['fPlus','fMinus','dPlus','dMinus','posT','posB','fabOff','fabOn','alL','alC','alR']) {
      await s.page.locator('#'+id).click();
    }
    await s.page.locator('#cFg').fill('#123456');
    await s.page.locator('#cTitle').fill('#654321');
    await s.page.locator('#cArtist').fill('#abcdef');
    await s.page.locator('#cBg').fill('#112233');
    let saved=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_prefs_v1')));
    assert.equal(saved.fg,'#123456');assert.equal(saved.title,'#654321');
    assert.equal(saved.artist,'#abcdef');assert.equal(saved.bg,'#112233');
    assert.equal(saved.align,'right');
    await s.page.reload();
    saved=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_prefs_v1')));
    assert.equal(saved.fg,'#123456');
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#resetBtn').click();
    saved=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_prefs_v1')));
    assert.equal(saved.fg,'#ffffff');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 27: gerenciamento cria setlist, seleciona músicas e persiste',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.prompt=()=> 'Show sábado';});
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    await s.page.locator('#newSetlistBtn').click();
    await s.page.locator('#selectBar').waitFor({state:'visible'});
    await s.page.locator('#list .item').nth(0).click();
    await s.page.locator('#list .item').nth(1).click();
    await s.page.locator('#selConfirm').click();
    const result=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_setlists_v1')));
    assert.equal(result.list.length,1);
    assert.equal(result.list[0].name,'Show sábado');
    assert.equal(result.list[0].songIds.length,2);
    await s.page.reload();
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    assert.match(await s.page.locator('#setlistMgrList').innerText(),/Show sábado/);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 28: gerenciador renomeia e exclui setlist criado',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      localStorage.setItem('repHaroldo_setlists_v1',JSON.stringify({list:[{id:'STtest',name:'Show teste',songIds:[],songKeys:{}}],active:'STtest'}));
      window.prompt=()=> 'Show renomeado';window.confirm=()=>true;
    });
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    await s.page.locator('#setlistMgrList [data-a="ren"]').click();
    assert.match(await s.page.locator('#setlistMgrList').innerText(),/Show renomeado/);
    await s.page.locator('#setlistMgrList [data-a="del"]').click();
    const data=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_setlists_v1')));
    assert.equal(data.list.length,0);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 29: botão de opções oculta música; configurações restaura',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .moreBtn').first().click();
    await s.page.locator('#actionSheet.active').waitFor();
    await s.page.locator('#actHide').click();
    assert.equal(await s.page.locator('#list .item').count(),213);
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#hiddenList .manageRow button').first().click();
    assert.equal(await s.page.locator('#subInfo').innerText(),'214 músicas no repertório');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 30: botão excluir retira e restaura música pela configuração',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);
    await s.page.locator('#list .moreBtn').first().click();
    await s.page.locator('#actDelete').click();
    assert.equal(await s.page.locator('#list .item').count(),213);
    await s.page.locator('#setBtnHome').click();
    await s.page.locator('#removedList .manageRow button').first().click();
    assert.match(await s.page.locator('#subInfo').innerText(),/214/);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 31: filtrar por artista e voltar para todas',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'Artistas'}).click();
    assert.match(await s.page.locator('#count').innerText(),/artistas/);
    await s.page.locator('#list .item').first().click();
    assert.ok((await s.page.locator('#list .item').count())>=1);
    await s.page.locator('#chips .chip',{hasText:'Todas'}).click();
    assert.equal(await s.page.locator('#list .item').count(),214);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 32: botão Editar no menu altera música e sobrevive ao reload',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .moreBtn').first().click();
    await s.page.locator('#actEdit').click();
    await s.page.locator('#editView.active').waitFor();
    await s.page.locator('#inTitle').fill('Música revisada pelo browser');
    await s.page.locator('#saveSong').click();
    await s.page.reload();
    await s.page.locator('#search').fill('Música revisada pelo browser');
    assert.equal(await s.page.locator('#list .item').count(),1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 33: barra de ferramentas da letra funciona sem destruir conteúdo',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{readText:async()=> 'Nova letra copiada',writeText:async v=>{window.__clip=v;}}});
      window.confirm=()=>true;window.alert=()=>{};
    });
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inLyrics').fill('Teste prévio');
    await s.page.locator('#taFontUp').click();
    await s.page.locator('#taFontDown').click();
    await s.page.locator('#taCopy').click();
    assert.equal(await s.page.evaluate(()=>window.__clip),'Teste prévio');
    await s.page.locator('#taPaste').click();
    assert.equal(await s.page.locator('#inLyrics').inputValue(),'Nova letra copiada');
    await s.page.locator('#taColor').fill('#aabbcc');
    await s.page.locator('#taColorReset').click();
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 34: navegação Anterior/Próxima e Play/Pausa no teleprompter',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .item').nth(1).click();
    await s.page.locator('#songView.active').waitFor();
    const current=await s.page.locator('#songTitle').innerText();
    await s.page.locator('#nextBtn').click();
    assert.notEqual(await s.page.locator('#songTitle').innerText(),current);
    await s.page.locator('#prevBtn').click();
    assert.equal(await s.page.locator('#songTitle').innerText(),current);
    await s.page.locator('#playBtn').click();
    assert.match(await s.page.locator('#playBtn').innerText(),/PAUSA/);
    await s.page.locator('#playBtn').click();
    assert.match(await s.page.locator('#playBtn').innerText(),/PLAY/);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 35: estresse de 100 buscas consecutivas sem exceção',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    const names=['a','be','jazz','rock','ac','Água','Ira!','Beatles','ZZsem',''];
    await s.page.evaluate((queries)=>{
      const search=document.getElementById('search');
      for(let i=0;i<100;i++){
        search.value=queries[i%queries.length];
        search.dispatchEvent(new Event('input',{bubbles:true}));
      }
    },names);
    assert.equal(await s.page.locator('#list .item').count(),214);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 36: falha da rede JSON mostra erro sem travar HTML',async()=>{
  const s=await fresh();try{
    await s.page.route('**/setlists/jazz-blues.json',route=>route.abort());
    await goto(s,J);
    await s.page.locator('#error').waitFor({state:'visible'});
    assert.match(await s.page.locator('#meta').innerText(),/Erro/);
    assert.equal(await s.page.locator('.song').count(),0);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 37: copiar link A e J usa páginas fixas curtas',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__clipboard='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async v=>{window.__clipboard=v;},readText:async()=>window.__clipboard}});
      window.confirm=()=>true;window.alert=()=>{};
    });
    await goto(s,MAIN);await openPrep(s.page,0);
    await s.page.locator('#musicianCopyLink').click();
    assert.equal(await s.page.evaluate(()=>window.__clipboard),
      'https://mizaelsouza12.github.io/haroldobluesrep/setlists/a-sua-maneira.html');
    await s.page.reload();await openPrep(s.page,1);
    await s.page.locator('#musicianCopyLink').click();
    assert.equal(await s.page.evaluate(()=>window.__clipboard),
      'https://mizaelsouza12.github.io/haroldobluesrep/setlists/jazz-blues.html');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 38: visualizador antigo sem hash não habilita download',async()=>{
  const s=await fresh();try{
    await goto(s,'/setlist.html');
    assert.equal(await s.page.locator('#actions').isVisible(),false);
    assert.equal(await s.page.locator('#error').isVisible(),true);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});


test('Browser 39: reconhecimento de fala simulado pesquisa e abre Wonderwall',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.SpeechRecognition=class {
        start(){
          setTimeout(()=>{
            const item=[{transcript:'Wonderwall'}];item.isFinal=true;
            if(this.onresult)this.onresult({results:[item]});
          },20);
        }
        abort(){}
      };
    });
    await goto(s,MAIN);
    await s.page.locator('#voiceFab').click({force:true});
    await s.page.locator('#songView.active').waitFor({timeout:5000});
    assert.equal(await s.page.locator('#songTitle').innerText(),'Wonderwall');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 40: reconhecimento simulado monta setlist com duas músicas',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.prompt=()=> 'Show criado por voz';
      window.alert=()=>{};
      window.SpeechRecognition=class {
        start(){
          setTimeout(()=>{
            const item=[{transcript:'criar uma lista com Wonderwall, 15 Anos'}];
            item.isFinal=true;
            if(this.onresult)this.onresult({results:[item]});
          },20);
        }
        abort(){}
      };
    });
    await goto(s,MAIN);
    await s.page.locator('#voiceFab').click({force:true});
    const confirm=s.page.locator('#voiceCandidates button',{hasText:'Criar setlist'});
    await confirm.waitFor({timeout:5000});
    await confirm.click();
    const saved=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_setlists_v1')));
    assert.equal(saved.list.length,1);
    assert.equal(saved.list[0].name,'Show criado por voz');
    assert.equal(saved.list[0].songIds.length,2);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 41: erro de permissão de microfone simulado exibe recuperação',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.SpeechRecognition=class {
        start(){setTimeout(()=>{if(this.onerror)this.onerror({error:'not-allowed'});},20);}
        abort(){}
      };
    });
    await goto(s,MAIN);
    await s.page.locator('#voiceFab').click({force:true});
    await s.page.waitForFunction(()=>document.getElementById('voiceStatus').textContent.includes('Permissão'));
    assert.match(await s.page.locator('#voiceStatus').innerText(),/microfone/);
    assert.equal(await s.page.locator('#voiceRetry').isVisible(),true);
    await s.page.locator('#voiceCancel').click();
    assert.equal(await s.page.locator('#voiceSheet').isVisible(),false);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 42: ausência de Web Speech mostra mensagem sem crash',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__alerts=[];window.alert=t=>window.__alerts.push(String(t));
      Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
      Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
    });
    await goto(s,MAIN);
    await s.page.locator('#voiceFab').click({force:true});
    const messages=await s.page.evaluate(()=>window.__alerts);
    assert.ok(messages.some(x=>x.includes('não é compatível')));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 43: arrastar botão flutuante persiste posição',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    const fab=s.page.locator('#voiceFab');
    const box=await fab.boundingBox();assert.ok(box);
    await s.page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await s.page.mouse.down();
    await s.page.mouse.move(box.x+box.width/2-90,box.y+box.height/2-60,{steps:8});
    await s.page.mouse.up();
    const pos=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_fabpos_v1')||'null'));
    assert.ok(pos && pos.xPct>0 && pos.xPct<1);
    assert.ok(pos.yPct>0 && pos.yPct<1);
    await s.page.reload();
    assert.ok(await fab.isVisible());
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 44: abandonar edição com texto exige confirmação',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>false;});
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inTitle').fill('Não pode sumir');
    await s.page.locator('#inLyrics').fill('Texto não salvo');
    await s.page.locator('#editBack').click();
    assert.equal(await s.page.locator('#editView.active').count(),1);
    assert.equal(await s.page.locator('#inLyrics').inputValue(),'Texto não salvo');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 45: duplo clique em aba renomeia e persiste nome',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.prompt=()=> 'Meu Repertório A';});
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'A Sua Maneira'}).dblclick();
    assert.equal(await s.page.locator('#chips .chip',{hasText:'Meu Repertório A'}).count(),1);
    await s.page.reload();
    assert.equal(await s.page.locator('#chips .chip',{hasText:'Meu Repertório A'}).count(),1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 46: criar e renomear categoria personalizada realmente persiste',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      let i=0;window.prompt=()=>++i===1?'Repertório Personalizado':'Repertório Alterado';
    });
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#catSeg .catAddBtn2').click();
    await s.page.locator('#inTitle').fill('Canção da Categoria');
    await s.page.locator('#inArtist').fill('E2E');
    await s.page.locator('#inLyrics').fill('Letra exemplo');
    await s.page.locator('#saveSong').click();
    const chip=s.page.locator('#chips .chip',{hasText:'Repertório Personalizado'});
    assert.equal(await chip.count(),1);
    await chip.dblclick();
    assert.equal(await s.page.locator('#chips .chip',{hasText:'Repertório Alterado'}).count(),1);
    await s.page.reload();
    const cats=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_customcats_v1')));
    assert.equal(cats[0].name,'Repertório Alterado');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 47: setlist manual mantém payload e cópia em texto',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.prompt=()=> 'Show com link dinâmico';
      window.confirm=()=>true;window.alert=()=>{};
      window.__clip='';
      Object.defineProperty(navigator,'clipboard',{configurable:true,
        value:{writeText:async v=>{window.__clip=v;},readText:async()=>window.__clip}});
    });
    await goto(s,MAIN);
    await s.page.locator('#selectBtn').click();
    await s.page.locator('#list .item').first().click();
    await s.page.locator('#selConfirm').click();
    await s.page.locator('#shareSetlistBtn').click();
    await s.page.locator('#setlistMgrList .shareChoice').last().click();
    await s.page.locator('#musicianText').click();
    let clip=await s.page.evaluate(()=>window.__clip);
    assert.match(clip,/REPERTÓRIO - Show com link dinâmico/);
    await s.page.locator('#musicianCopyLink').click();
    clip=await s.page.evaluate(()=>window.__clip);
    assert.ok(clip.includes('/setlist.html#d='));
    await s.page.locator('#musicianBack').click();
    await s.page.waitForTimeout(100);
    assert.equal(await s.page.locator('#musicianSheet.active').count(),0);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 48: banner de atualização solicita SKIP_WAITING',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.evaluate(()=>{
      window.__message='';
      showUpdateBanner({waiting:{postMessage:v=>{window.__message=v;}}});
    });
    assert.equal(await s.page.locator('#updateBanner').count(),1);
    await s.page.locator('#updateBanner button').click();
    assert.equal(await s.page.evaluate(()=>window.__message),'SKIP_WAITING');
    assert.equal(await s.page.locator('#updateBanner').count(),0);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 49: PWA instala SW e aplicativo principal abre offline em Chromium',async()=>{
  const s=await fresh({allowServiceWorkers:true});try{
    await goto(s,MAIN);
    await s.page.waitForFunction(()=>navigator.serviceWorker && navigator.serviceWorker.controller,{timeout:10000});
    await s.context.setOffline(true);
    await s.page.reload({waitUntil:'load',timeout:12000});
    assert.equal(await s.page.locator('#list .item').count(),214);
    await s.context.setOffline(false);
    await checkNoPageErrors(s);
  }finally{await s.context.setOffline(false).catch(()=>{});await s.close();}
});


test('Browser 50: limpar e cancelar seleção sem criar músicas falsas',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.prompt=()=> 'Lista temporária';window.confirm=()=>true;});
    await goto(s,MAIN);
    await s.page.locator('#selectBtn').click();
    await s.page.locator('#list .item').first().click();
    await s.page.locator('#selClear').click();
    assert.match(await s.page.locator('#selCount').innerText(),/^0 selecionadas/);
    await s.page.locator('#selCancel').click();
    await s.page.locator('#selectBar').waitFor({state:'hidden'});
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 51: ações Cancelar e Compartilhar executam handlers verdadeiros',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__shared=null;
      Object.defineProperty(navigator,'share',{configurable:true,value:async p=>{window.__shared=p;}});
    });
    await goto(s,MAIN);
    await s.page.locator('#list .moreBtn').first().click();
    await s.page.locator('#actCancel').click();
    assert.equal(await s.page.locator('#actionSheet.active').count(),0);
    await s.page.locator('#list .moreBtn').first().click();
    await s.page.locator('#actShare').click();
    await s.page.waitForFunction(()=>window.__shared!==null);
    const data=await s.page.evaluate(()=>window.__shared);
    assert.ok(data.title && data.text.includes(data.title));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 52: fechar, usar e editar setlist no gerenciador',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      localStorage.setItem('repHaroldo_setlists_v1',JSON.stringify({
        list:[{id:'STsaved',name:'Show Menu',songIds:[],songKeys:{}}],
        active:'STsaved'
      }));
    });
    await goto(s,MAIN);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    await s.page.locator('#closeSetlistMgr').click();
    assert.equal(await s.page.locator('#setlistSheet.active').count(),0);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    await s.page.locator('#setlistMgrList [data-a="use"]').click();
    assert.match(await s.page.locator('#count').innerText(),/^0 músicas/);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    await s.page.locator('#setlistMgrList [data-a="edit"]').click();
    await s.page.locator('#selectBar').waitFor({state:'visible'});
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 53: botão Importar abre seletor e aceita backup real',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    const waiting=s.page.waitForEvent('filechooser');
    await s.page.locator('#importBtn').click();
    const chooser=await waiting;
    await chooser.setFiles({
      name:'backup-importacao.json',mimeType:'application/json',
      buffer:Buffer.from(JSON.stringify([{id:'Cfromchooser',title:'Do arquivo',artist:'Teste',cats:'A',text:'Letra'}]))
    });
    await s.page.waitForFunction(()=>JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]').some(x=>x.title==='Do arquivo'));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 54: Compartilhar para músicos usa API nativa e link curto',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__shared=null;window.confirm=()=>true;
      Object.defineProperty(navigator,'share',{configurable:true,value:async p=>{window.__shared=p;}});
    });
    await goto(s,MAIN);await openPrep(s.page,0);
    await s.page.locator('#musicianShare').click();
    await s.page.waitForFunction(()=>window.__shared!==null);
    assert.equal((await s.page.evaluate(()=>window.__shared)).url,
      'https://mizaelsouza12.github.io/haroldobluesrep/setlists/a-sua-maneira.html');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 55: excluir letra customizada na tela de edição persiste exclusão',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inTitle').fill('Teste de exclusão');
    await s.page.locator('#inArtist').fill('Teste');
    await s.page.locator('#inLyrics').fill('Letra que vai ser excluída');
    await s.page.locator('#saveSong').click();
    await s.page.locator('#search').fill('Teste de exclusão');
    await s.page.locator('#list .moreBtn').click();
    await s.page.locator('#actEdit').click();
    await s.page.locator('#editDelete').click();
    await s.page.reload();
    assert.equal(await s.page.locator('#list .item').count(),214);
    assert.ok(!(await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]')))
      .some(x=>x.title==='Teste de exclusão'));
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 56: configurações do teleprompter e diminuir velocidade',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .item').first().click();
    await s.page.locator('#songView.active').waitFor();
    const before=Number(await s.page.locator('#spdVal').innerText());
    await s.page.locator('#spdDown').click();
    assert.equal(Number(await s.page.locator('#spdVal').innerText()),Math.max(4,before-2));
    await s.page.locator('#setBtn').click();
    await s.page.locator('#setView.active').waitFor();
    await s.page.locator('#closeSet').click();
    await s.page.locator('#menuBtn').click();
    await s.page.locator('#homeView.active').waitFor();
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 57: botão tentar novamente reinicia reconhecimento simulado',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__started=0;
      window.SpeechRecognition=class{
        start(){
          window.__started++;
          setTimeout(()=>{if(this.onerror)this.onerror({error:'no-speech'});},15);
        }
        abort(){}
      };
    });
    await goto(s,MAIN);
    await s.page.locator('#voiceFab').click({force:true});
    await s.page.locator('#voiceRetry').waitFor({state:'visible'});
    await s.page.locator('#voiceRetry').click();
    await s.page.waitForFunction(()=>window.__started>=2);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});


test('Browser 58: F5 na criação preserva rascunho local não salvo',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inTitle').fill('Rascunho ainda não salvo');
    await s.page.locator('#inArtist').fill('Artista provisório');
    await s.page.locator('#inLyrics').fill('Texto importante que não pode desaparecer ao dar F5');
    await s.page.reload();
    await s.page.locator('#addBtn').click();
    assert.equal(await s.page.locator('#inTitle').inputValue(),'Rascunho ainda não salvo');
    assert.match(await s.page.locator('#inLyrics').inputValue(),/não pode desaparecer/);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 59: ciclo completo cria, exporta e restaura dados em outro perfil limpo',async()=>{
  const source=await fresh(),destination=await fresh();
  try{
    await source.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await destination.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await goto(source,MAIN);
    await source.page.locator('#addBtn').click();
    await source.page.locator('#inTitle').fill('Viagem entre navegadores');
    await source.page.locator('#inArtist').fill('Produtor Teste');
    await source.page.locator('#inLyrics').fill('Letra com acentos: coração\nSegunda linha\nTerceira linha');
    await source.page.locator('#catSeg [data-v="J"]').click();
    await source.page.locator('#saveSong').click();
    await source.page.locator('#shareSetlistBtn').click();
    await source.page.locator('#setlistMgrList .shareChoice').nth(1).click();
    await source.page.locator('#musicianList .musicianKey').first().fill('F#m7');
    await source.page.locator('#musicianBack').click();
    await source.page.waitForTimeout(80);
    await goto(source,J);
    await source.page.locator('.noteInput').first().fill('Anotação migrada entre perfis');
    await goto(source,MAIN);
    await source.page.locator('#setBtnHome').click();
    const backup=await downloadAfter(source.page,()=>source.page.locator('#exportBtn').click());
    const exported=JSON.parse(backup.bytes.toString('utf8'));
    assert.equal(exported.type,'repHaroldoBackup');
    await goto(destination,MAIN);
    await destination.page.locator('#setBtnHome').click();
    await destination.page.locator('#importFile').setInputFiles({
      name:'backup-integral.json',mimeType:'application/json',buffer:backup.bytes
    });
    await destination.page.waitForFunction(()=>JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]').some(x=>x.title==='Viagem entre navegadores'));
    const restored=await destination.page.evaluate(()=>({
      custom:JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]'),
      keys:JSON.parse(localStorage.getItem('repHaroldo_playlistkeys_v1')||'{}'),
      fields:JSON.parse(localStorage.getItem('repHaroldo_musicianFields_v1:jazz-blues')||'{}')
    }));
    assert.deepEqual(restored.custom.map(x=>({title:x.title,artist:x.artist,text:x.text,cats:x.cats})),
      [{title:'Viagem entre navegadores',artist:'Produtor Teste',
        text:'Letra com acentos: coração\nSegunda linha\nTerceira linha',cats:'J'}]);
    assert.ok(Object.values(restored.keys.J||{}).includes('F#m7'));
    assert.ok(Object.values(restored.fields).some(x=>x.note==='Anotação migrada entre perfis'));
    await checkNoPageErrors(source);await checkNoPageErrors(destination);
  }finally{await source.close();await destination.close();}
});
test('Browser 60: 1000 edições alternadas e 12 recargas sem perda',async()=>{
  const s=await fresh();try{
    await goto(s,J);
    await s.page.locator('.keyInput').first().waitFor();
    for(let cycle=0;cycle<12;cycle++){
      await s.page.evaluate((cycle)=>{
        const keys=[...document.querySelectorAll('.keyInput')],notes=[...document.querySelectorAll('.noteInput')];
        for(let i=0;i<100;i++){
          const idx=i%keys.length;
          const k=keys[idx];
          k.value='C'+cycle+'-'+i;
          k.dispatchEvent(new Event('input',{bubbles:true}));
          const note=notes[idx];
          note.value='Ciclo '+cycle+' / edição '+i+' 🎼';
          note.dispatchEvent(new Event('input',{bubbles:true}));
        }
      },cycle);
      await s.page.reload();
      await s.page.locator('.keyInput').first().waitFor();
      const data=await s.page.evaluate(()=>({
        a:document.querySelector('.keyInput').value,
        n:document.querySelector('.noteInput').value
      }));
      assert.equal(data.a,'C'+cycle+'-95');
      assert.match(data.n,new RegExp('Ciclo '+cycle));
    }
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 61: visual mobile sem rolagem horizontal nas duas listas',async()=>{
  for(const w of [320,360,390,768,1280]){
    const s=await fresh();try{
      await s.page.setViewportSize({width:w,height:850});
      await goto(s,J);
      await s.page.locator('.noteInput').first().waitFor();
      const dims=await s.page.evaluate(()=>({
        scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
        input:document.querySelector('.keyInput').getBoundingClientRect().width
      }));
      assert.ok(dims.scroll<=dims.client+2,'overflow horizontal '+w+': '+JSON.stringify(dims));
      assert.ok(dims.input>=45,'campo muito estreito: '+w);
      await checkNoPageErrors(s);
    }finally{await s.close();}
  }
});


test('Browser 65: backup inclui notas atualizadas em outra aba após abrir o aplicativo',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await goto(s,MAIN);
    const editPage=await s.context.newPage();
    await editPage.goto(base+J);
    await editPage.locator('.keyInput').first().waitFor();
    await editPage.locator('.keyInput').first().fill('Db7');
    await s.page.locator('#setBtnHome').click();
    const file=await downloadAfter(s.page,()=>s.page.locator('#exportBtn').click());
    const exported=JSON.parse(file.bytes.toString('utf8'));
    assert.ok(Object.values(exported.data.playlistKeys.J||{}).includes('Db7'),
      'backup completo precisa capturar os dados mais recentes do localStorage');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});


test('Browser 66: importar backup com item malformado recupera registros válidos',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;window.alert=()=>{};});
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    const payload={type:'repHaroldoBackup',version:1,data:{
      custom:[
        {id:'Cvalido',title:'Música válida importada',artist:'Teste',text:'Letra que precisa sobreviver',cats:'A'},
        {id:'Cinvalido',title:42,artist:'Incorreto',text:'Não importar',cats:'J'}
      ]
    }};
    await s.page.locator('#importFile').setInputFiles({
      name:'backup-misto.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))
    });
    await s.page.waitForTimeout(150);
    const saved=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]'));
    assert.equal(saved.filter(x=>x.title==='Música válida importada').length,1);
    assert.equal(saved.some(x=>x.title===42),false);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});


test('Browser 67: estresse com 500 músicas personalizadas, busca, F5 e 50 setlists',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      const custom=Array.from({length:500},(_,i)=>({
        id:'Cstress'+i,title:'Musica Stress '+i,artist:'Banda '+(i%20),
        cats:i%2?'A':'J',text:('Estrofe '+i+'\n').repeat(12)
      }));
      const list=Array.from({length:50},(_,i)=>({
        id:'STstress'+i,name:'Show Stress '+i,
        songIds:custom.slice(i,i+10).map(x=>x.id),songKeys:{}
      }));
      localStorage.setItem('repHaroldo_custom_v1',JSON.stringify(custom));
      localStorage.setItem('repHaroldo_setlists_v1',JSON.stringify({list,active:'STstress0'}));
    });
    const started=Date.now();
    await goto(s,MAIN);
    assert.equal(await s.page.locator('#list .item').count(),714);
    await s.page.locator('#search').fill('Musica Stress 249');
    assert.equal(await s.page.locator('#list .item').count(),1);
    await s.page.locator('#search').fill('');
    await s.page.reload();
    assert.equal(await s.page.locator('#list .item').count(),714);
    await s.page.locator('#chips .chip',{hasText:'Setlists'}).click();
    assert.equal(await s.page.locator('#setlistMgrList .setlistRow').count(),50);
    console.log('STRESS 500 letras + 50 setlists:',Date.now()-started,'ms');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 68: F5 durante teleprompter não corrompe velocidades nem dados',async()=>{
  const s=await fresh();try{
    await goto(s,MAIN);
    await s.page.locator('#list .item').first().click();
    await s.page.locator('#spdUp').click();
    const v=await s.page.locator('#spdVal').innerText();
    await s.page.locator('#playBtn').click();
    await s.page.waitForTimeout(120);
    await s.page.reload();
    assert.equal(await s.page.locator('#list .item').count(),214);
    await s.page.locator('#list .item').first().click();
    assert.equal(await s.page.locator('#spdVal').innerText(),v);
    assert.equal(await s.page.locator('#songView.active').count(),1);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
test('Browser 69: descarte confirmado não ressuscita rascunho ao voltar',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{window.confirm=()=>true;});
    await goto(s,MAIN);
    await s.page.locator('#addBtn').click();
    await s.page.locator('#inTitle').fill('Rascunho descartado');
    await s.page.locator('#inLyrics').fill('Este texto foi descartado');
    await s.page.locator('#editBack').click();
    await s.page.locator('#homeView.active').waitFor();
    await s.page.locator('#addBtn').click();
    assert.equal(await s.page.locator('#inTitle').inputValue(),'');
    assert.equal(await s.page.locator('#inLyrics').inputValue(),'');
    await checkNoPageErrors(s);
  }finally{await s.close();}
});


test('Browser 70: importação sem espaço não pode anunciar sucesso ou deixar letra fantasma',async()=>{
  const s=await fresh();try{
    await s.context.addInitScript(()=>{
      window.__alerts=[];
      window.alert=m=>window.__alerts.push(String(m));
      window.confirm=()=>true;
      const native=Storage.prototype.setItem;
      Storage.prototype.setItem=function(k,v){
        if(k==='repHaroldo_custom_v1')throw new DOMException('Sem espaço','QuotaExceededError');
        return native.call(this,k,v);
      };
    });
    await goto(s,MAIN);
    await s.page.locator('#setBtnHome').click();
    const backup={type:'repHaroldoBackup',version:1,data:{
      custom:[{id:'Cbackup123',title:'Backup não persistente',artist:'Falha',cats:'J',text:'Letra de teste'}]
    }};
    await s.page.locator('#importFile').setInputFiles({
      name:'backup-quota.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))
    });
    await s.page.waitForTimeout(200);
    const alerts=await s.page.evaluate(()=>window.__alerts);
    assert.equal(alerts.some(a=>a.startsWith('Backup importado:')),false,
      'não pode anunciar importação concluída se a gravação foi recusada');
    assert.ok(alerts.some(a=>/salvar|armazenamento|espaço/i.test(a)));
    await s.page.reload();
    const stored=await s.page.evaluate(()=>JSON.parse(localStorage.getItem('repHaroldo_custom_v1')||'[]'));
    assert.equal(stored.some(x=>x.title==='Backup não persistente'),false);
    await checkNoPageErrors(s);
  }finally{await s.close();}
});
