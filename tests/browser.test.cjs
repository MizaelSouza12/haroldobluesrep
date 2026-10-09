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
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
});

async function fresh({mobile=false,locale='pt-BR'}={}){
  const context=await browser.newContext({
    viewport:mobile?{width:390,height:844}:{width:1440,height:900},
    isMobile:mobile,hasTouch:mobile,locale,
    acceptDownloads:true,
    permissions:['clipboard-read','clipboard-write'],
    serviceWorkers:'block'
  });
  const page=await context.newPage();
  const failures=[];
  page.on('pageerror',e=>failures.push(e.message));
  return {context,page,failures,close:()=>context.close()};
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
