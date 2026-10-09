'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM, VirtualConsole} = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const mainHtml = read('repertorio-haroldo.html');
const standalone = read('setlist.html');
const editorJS = read('setlists/editor.js');
const sw = read('sw.js');
const aHTML = read('setlists/a-sua-maneira.html');
const jHTML = read('setlists/jazz-blues.html');
const aData = JSON.parse(read('setlists/a-sua-maneira.json'));
const jData = JSON.parse(read('setlists/jazz-blues.json'));
const scriptsOf = html => [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/type=["']text\/plain["']/i.test(m[1]))
  .map(m => m[2]).filter(s => s.trim());
const mainScript = scriptsOf(mainHtml).join('\n');
const standaloneScript = scriptsOf(standalone).join('\n');

function createStorage(seed) {
  const map = seed || new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] || null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k,v) { map.set(String(k),String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    map
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(html, url, sharedStorage) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message));
  const dom = new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w = dom.window;
  if(sharedStorage) Object.defineProperty(w,'localStorage',{configurable:true,value:sharedStorage});
  w.TextEncoder=global.TextEncoder; w.TextDecoder=global.TextDecoder;
  w.alert=()=>{}; w.confirm=()=>true; w.prompt=()=>null;
  w.scrollTo=()=>{}; w.print=()=>{};
  w.URL.createObjectURL=()=> 'blob:fake'; w.URL.revokeObjectURL=()=>{};
  w.navigator.vibrate=()=>false;
  Object.defineProperty(w.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{},readText:async()=>''}});
  return {dom,w,errors};
}
function bootMain(sharedStorage) {
  const env=setup(mainHtml,'https://mizaelsouza12.github.io/haroldobluesrep/repertorio-haroldo.html',sharedStorage);
  vm.runInContext(mainScript, env.dom.getInternalVMContext());
  return env;
}
async function bootEditor(slug,sharedStorage,fixture) {
  const html = slug==='a-sua-maneira' ? aHTML : jHTML;
  const data = fixture || (slug==='a-sua-maneira'?aData:jData);
  const env=setup(html,'https://mizaelsouza12.github.io/haroldobluesrep/setlists/'+slug+'.html',sharedStorage);
  let copied='';
  env.w.navigator.clipboard.writeText=async v=>{copied=v;};
  env.w.fetch=async()=>({ok:true,json:async()=>data});
  env.w.eval(editorJS);
  await tick(); await tick();
  return {...env,getCopied:()=>copied};
}
function input(el,value,w) {
  el.value=value;
  el.dispatchEvent(new w.Event('input',{bubbles:true}));
}
function fixtureSongs(html) {
  const m=html.match(/<script type="text\/plain" id="songdata">([\s\S]*?)<\/script>/i);
  assert.ok(m,'dados do repertório estão presentes');
  return m[1].split('\n').filter(line=>line.startsWith('### ')).map(line=>{
    const p=line.slice(4).split(';;').map(s=>s.trim());
    return {title:p[0],artist:p[1],cats:p[2]||'A'};
  });
}
const sourceSongs=fixtureSongs(mainHtml);
function stableSongId(title,artist) {
  const str=(title+'|'+artist).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  let h=2166136261;
  for(let i=0;i<str.length;i++) {h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return 'SB'+(h>>>0).toString(36);
}

test('01: HTML, script principal, editor, visualizador e service worker sem erros de sintaxe',()=>{
  assert.ok(mainScript.length>30000);
  new vm.Script(mainScript);
  new vm.Script(standaloneScript);
  new vm.Script(editorJS);
  new vm.Script(sw);
  for(const page of [aHTML,jHTML]) assert.ok(page.includes('src="./editor.js"'));
});
test('02: dados originais íntegros: 214 músicas',()=>assert.equal(sourceSongs.length,214));
test('03: categoria A tem 204 músicas',()=>assert.equal(sourceSongs.filter(s=>s.cats.includes('A')).length,204));
test('04: categoria J tem 19 músicas',()=>assert.equal(sourceSongs.filter(s=>s.cats.includes('J')).length,19));
test('05: músicas AJ entram em ambas categorias',()=>assert.equal(sourceSongs.filter(s=>s.cats==='AJ').length,9));
test('06: IDs estáveis sem colisões nos dados originais',()=>{
  assert.equal(new Set(sourceSongs.map(s=>stableSongId(s.title,s.artist))).size,sourceSongs.length);
});
test('07: JSON A mantém todas as músicas previstas sem duplicar',()=>{
  assert.equal(aData.songs.length,204);
  assert.deepEqual(new Set(aData.songs.map(s=>s.title+'|'+s.artist)),
    new Set(sourceSongs.filter(s=>s.cats.includes('A')).map(s=>s.title+'|'+s.artist)));
});
test('08: JSON J mantém todas as músicas previstas sem duplicar',()=>{
  assert.equal(jData.songs.length,19);
  assert.deepEqual(new Set(jData.songs.map(s=>s.title+'|'+s.artist)),
    new Set(sourceSongs.filter(s=>s.cats.includes('J')).map(s=>s.title+'|'+s.artist)));
});
test('09: dados públicos são apenas título, artista, nota',()=>{
  for(const data of [aData,jData]){
    for(const s of data.songs){
      assert.deepEqual(Object.keys(s).sort(),['artist','key','title']);
      assert.equal(typeof s.title,'string');
      assert.equal(typeof s.artist,'string');
      assert.equal(typeof s.key,'string');
      assert.equal(s.text,undefined);
      assert.equal(s.lyrics,undefined);
    }
  }
});
test('10: URLs fixas estão presentes sem tokens secretos',()=>{
  assert.ok(aHTML.includes('a-sua-maneira.json'));
  assert.ok(jHTML.includes('jazz-blues.json'));
  for(const html of [aHTML,jHTML]) {
    assert.ok(!/github_pat_|ghp_[a-z0-9]{20}|service_role/i.test(html));
    assert.ok(/data-slug=/.test(html));
  }
});
test('11: páginas públicas não incorporam o texto das letras',()=>{
  for(const html of [aHTML,jHTML]){
    assert.ok(!html.includes('id="songdata"'));
    assert.ok(!html.includes('cur.lines'));
    assert.ok(editorJS.includes('Tom / Nota'));
    assert.ok(html.includes('src="./editor.js"'));
    assert.ok(editorJS.includes('Anotação da música'));
  }
});
test('12: manifest tem JSON válido e start_url',()=>{
  const manifest=JSON.parse(read('manifest.json'));
  assert.ok(manifest.name || manifest.short_name);
  assert.ok(manifest.start_url);
});
test('13: main executa e mostra a lista inicial',()=>{
  const {w}=bootMain();
  assert.equal(w.eval('SONGS.length'),214);
  assert.equal(w.eval('ALL.length'),214);
  assert.ok(w.document.querySelectorAll('#list .item').length>0);
  w.close();
});
test('14: clicar na categoria A mostra 204 músicas',()=>{
  const {w}=bootMain();
  const chip=[...w.document.querySelectorAll('#chips .chip')].find(e=>e.textContent==='A Sua Maneira');
  assert.ok(chip);chip.click();
  assert.equal(w.document.querySelectorAll('#list .item').length,204);
  w.close();
});
test('15: clicar na categoria J mostra 19 músicas',()=>{
  const {w}=bootMain();
  const chip=[...w.document.querySelectorAll('#chips .chip')].find(e=>e.textContent==='Jazz & Blues');
  assert.ok(chip);chip.click();
  assert.equal(w.document.querySelectorAll('#list .item').length,19);
  w.close();
});
test('16: botão de envio abre os repertórios existentes, mesmo sem setlist manual',()=>{
  const {w}=bootMain();
  w.document.getElementById('shareSetlistBtn').click();
  const choices=[...w.document.querySelectorAll('#setlistMgrList .shareChoice')];
  assert.equal(choices.length,2);
  assert.ok(choices[0].textContent.includes('A Sua Maneira'));
  assert.ok(choices[1].textContent.includes('Jazz & Blues'));
  assert.equal(w.document.getElementById('newSetlistBtn').style.display,'none');
  w.close();
});
test('17: escolher Jazz & Blues prepara 19 músicas sem pedir nova playlist',()=>{
  const {w}=bootMain();
  w.document.getElementById('shareSetlistBtn').click();
  w.document.querySelectorAll('#setlistMgrList .shareChoice')[1].click();
  assert.equal(w.document.getElementById('musicianTitle').textContent,'Jazz & Blues');
  assert.equal(w.document.querySelectorAll('#musicianList .musicianRow').length,19);
  w.close();
});
test('18: cada repertório gera payload distinto sem letras privadas',()=>{
  const {w}=bootMain();
  const p=w.eval('[musicianPayload(sharePlaylistSource(shareablePlaylists()[0])), musicianPayload(sharePlaylistSource(shareablePlaylists()[1]))]');
  assert.equal(p[0].s.length,204);assert.equal(p[1].s.length,19);
  assert.notEqual(p[0].n,p[1].n);
  for(const x of [...p[0].s,...p[1].s]) {
    assert.equal(x.length,3);
    assert.ok(x.every(v=>typeof v==='string'));
  }
  w.close();
});
test('19: playlist manual salva é incluída entre escolhas de envio',()=>{
  const {w}=bootMain();
  w.eval("SETLISTS.push({id:'STtest',name:'Show Teste',songIds:[ALL[0].id],songKeys:{}})");
  w.document.getElementById('shareSetlistBtn').click();
  const choices=[...w.document.querySelectorAll('#setlistMgrList .shareChoice')];
  assert.equal(choices.length,3);
  assert.ok(choices[2].textContent.includes('Show Teste'));
  choices[2].click();
  assert.equal(w.document.querySelectorAll('#musicianList .musicianRow').length,1);
  w.close();
});
test('20: nota na preparação é persistida no localStorage de sua categoria',()=>{
  const store=createStorage();
  const {w}=bootMain(store);
  w.document.getElementById('shareSetlistBtn').click();
  w.document.querySelector('#setlistMgrList .shareChoice').click();
  const key=w.document.querySelector('#musicianList .musicianKey');
  input(key,'Bb7',w);
  const stored=JSON.parse(store.getItem('repHaroldo_playlistkeys_v1'));
  assert.ok(Object.values(stored.A).includes('Bb7'));
  w.close();
});
test('21: campos de nota aceitam cifra alfanumérica sem HTML executável',async()=>{
  const {w}=await bootEditor('jazz-blues',createStorage());
  const fields=w.document.querySelectorAll('.keyInput');
  assert.equal(fields.length,19);
  input(fields[0],'G#m7',w);
  assert.equal(fields[0].value,'G#m7');
  w.close();
});
test('22: texto de anotação multilinha é salvo no navegador',async()=>{
  const store=createStorage();
  const {w}=await bootEditor('jazz-blues',store);
  input(w.document.querySelector('.noteInput'),'Entrada da bateria\nRepetir duas vezes',w);
  const saved=JSON.parse(store.getItem('repHaroldo_musicianFields_v1:jazz-blues'));
  assert.ok(Object.values(saved).some(e=>e.note==='Entrada da bateria\nRepetir duas vezes'));
  w.close();
});
test('23: atualização da página recupera tom e anotação',async()=>{
  const store=createStorage();
  const first=await bootEditor('a-sua-maneira',store);
  input(first.w.document.querySelector('.keyInput'),'Eb',first.w);
  input(first.w.document.querySelector('.noteInput'),'Começar com baixo',first.w);
  first.w.close();
  const next=await bootEditor('a-sua-maneira',store);
  assert.equal(next.w.document.querySelector('.keyInput').value,'Eb');
  assert.equal(next.w.document.querySelector('.noteInput').value,'Começar com baixo');
  next.w.close();
});
test('24: campos da playlist A não aparecem na playlist J',async()=>{
  const store=createStorage();
  const first=await bootEditor('a-sua-maneira',store);
  const shared='Ain\'t No Sunshine';
  const sRow=[...first.w.document.querySelectorAll('.song')].find(row=>row.querySelector('.title').textContent===shared);
  assert.ok(sRow);
  input(sRow.querySelector('.keyInput'),'F#m',first.w);
  first.w.close();
  const other=await bootEditor('jazz-blues',store);
  const row=[...other.w.document.querySelectorAll('.song')].find(r=>r.querySelector('.title').textContent===shared);
  assert.ok(row);
  assert.equal(row.querySelector('.keyInput').value,'');
  other.w.close();
});
test('25: os dados não são sincronizados automaticamente entre navegadores',async()=>{
  const browser1=createStorage(),browser2=createStorage();
  const first=await bootEditor('jazz-blues',browser1);
  input(first.w.document.querySelector('.keyInput'),'A',first.w);
  first.w.close();
  const second=await bootEditor('jazz-blues',browser2);
  assert.equal(second.w.document.querySelector('.keyInput').value,'');
  second.w.close();
});
test('26: duas abas editando músicas diferentes não sobrescrevem uma à outra',async()=>{
  const storage=createStorage();
  const a=await bootEditor('jazz-blues',storage);
  const b=await bootEditor('jazz-blues',storage);
  input(a.w.document.querySelectorAll('.keyInput')[0],'C',a.w);
  input(b.w.document.querySelectorAll('.keyInput')[1],'D',b.w);
  const data=JSON.parse(storage.getItem('repHaroldo_musicianFields_v1:jazz-blues'));
  assert.equal(Object.keys(data).length,2);
  assert.deepEqual(new Set(Object.values(data).map(x=>x.key)),new Set(['C','D']));
  a.w.close();b.w.close();
});
test('27: copiar lista traz notas e anotações atualizadas',async()=>{
  const e=await bootEditor('jazz-blues',createStorage());
  input(e.w.document.querySelector('.keyInput'),'F#',e.w);
  input(e.w.document.querySelector('.noteInput'),'Pausa no final',e.w);
  e.w.document.getElementById('copyBtn').click();
  await tick();
  assert.ok(e.getCopied().includes('F#'));
  assert.ok(e.getCopied().includes('Pausa no final'));
  e.w.close();
});
test('28: impressão é acionada pelo botão de PDF',async()=>{
  const e=await bootEditor('jazz-blues',createStorage());
  let called=0;e.w.print=()=>{called++;};
  e.w.document.getElementById('printBtn').click();
  assert.equal(called,1);e.w.close();
});
test('29: um título HTML suspeito não vira conteúdo executável',async()=>{
  const data={name:'Teste',songs:[{title:'<img src=x onerror=alert(1)>',artist:'Artista',key:''}]};
  const e=await bootEditor('jazz-blues',createStorage(),data);
  assert.equal(e.w.document.querySelectorAll('#list img').length,0);
  assert.ok(e.w.document.querySelector('.title').textContent.includes('<img'));
  e.w.close();
});
test('30: falha de rede da playlist produz erro visível',async()=>{
  const e=setup(jHTML,'https://mizaelsouza12.github.io/haroldobluesrep/setlists/jazz-blues.html',createStorage());
  e.w.fetch=async()=>({ok:false,status:503});
  e.w.eval(editorJS);await tick();await tick();
  assert.equal(e.w.document.getElementById('error').style.display,'block');
  e.w.close();
});
test('31: dados de notas e anotações entram no backup completo',async()=>{
  const store=createStorage();
  const editor=await bootEditor('jazz-blues',store);
  input(editor.w.document.querySelector('.noteInput'),'Anotação para backup',editor.w);
  editor.w.close();
  const {w}=bootMain(store);
  const data=w.eval('exportMusicianFields()');
  assert.ok(data['jazz-blues']);
  assert.ok(Object.values(data['jazz-blues']).some(x=>x.note==='Anotação para backup'));
  w.close();
});
test('32: importação das anotações não apaga dados locais existentes',()=>{
  const store=createStorage();
  const {w}=bootMain(store);
  const existingId=stableSongId('Ain\'t No Sunshine','Bill Withers');
  store.setItem('repHaroldo_musicianFields_v1:jazz-blues',JSON.stringify({[existingId]:{key:'C',note:'LOCAL'}}));
  w.eval("importMusicianFields({ 'jazz-blues': { ["+JSON.stringify(existingId)+"]: {key:'D',note:'BACKUP'}, 'SBnovo': {key:'G',note:'NEW'}} }, {})");
  const d=JSON.parse(store.getItem('repHaroldo_musicianFields_v1:jazz-blues'));
  assert.equal(d[existingId].note,'LOCAL');
  assert.equal(d.SBnovo.note,'NEW');
  w.close();
});
test('33: visualizador de link sem hash bloqueia ações',()=>{
  const {w}=setup(standalone,'https://mizaelsouza12.github.io/haroldobluesrep/setlist.html');
  w.eval(standaloneScript);
  assert.equal(w.document.getElementById('actions').hidden,true);
  assert.equal(w.document.getElementById('error').style.display,'block');
  w.close();
});
test('34: visualizador do link contém apenas três campos e não executa HTML do título',()=>{
  const data={v:1,n:'Blues',s:[['<img src=x onerror=alert(1)>','Teste','F#']]};
  const hash=Buffer.from(JSON.stringify(data),'utf8').toString('base64url');
  const {w}=setup(standalone,'https://mizaelsouza12.github.io/haroldobluesrep/setlist.html#d='+hash);
  w.TextDecoder=global.TextDecoder;
  w.eval(standaloneScript);
  assert.equal(w.document.getElementById('actions').hidden,false);
  assert.equal(w.document.querySelectorAll('#list img').length,0);
  assert.equal(w.document.querySelectorAll('.song').length,1);
  assert.equal(w.document.querySelector('.key').textContent,'F#');
  w.close();
});
test('35: visualizador rejeita payload inválido e excessivo',()=>{
  for(const data of [{v:2,n:'X',s:[]},{v:1,n:'X',s:Array.from({length:301},()=>['a','b','c'])}]) {
    const hash=Buffer.from(JSON.stringify(data),'utf8').toString('base64url');
    const {w}=setup(standalone,'https://mizaelsouza12.github.io/haroldobluesrep/setlist.html#d='+hash);
    w.eval(standaloneScript);
    assert.equal(w.document.getElementById('actions').hidden,true);
    w.close();
  }
});
test('36: SW registra cache, ativa e responde a FETCH sem inicialização quebrada',()=>{
  const handlers={};
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://mizaelsouza12.github.io'}};
  vm.runInNewContext(sw,{self,caches:{},fetch:()=>{},URL,Response});
  assert.ok(handlers.install);
  assert.ok(handlers.activate);
  assert.ok(handlers.fetch);
  assert.ok(handlers.message);
});
test('37: SW trata /setlists/ como network-first e sem cache antigo',async()=>{
  const handlers={};let opts=null;let response=null;
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://mizaelsouza12.github.io'}};
  const fetch=async(req,o)=>{opts=o;return new Response('novo',{status:200});};
  vm.runInNewContext(sw,{self,caches:{match:async()=>null},fetch,URL,Response});
  handlers.fetch({
    request:{method:'GET',url:'https://mizaelsouza12.github.io/haroldobluesrep/setlists/jazz-blues.html'},
    respondWith:p=>{response=p;}
  });
  const res=await response;
  assert.equal(await res.text(),'novo');
  assert.equal(opts.cache,'no-store');
});
test('38: SW offline sem cópia da playlist devolve 503',async()=>{
  const handlers={};let response=null;
  const self={addEventListener:(name,fn)=>handlers[name]=fn,location:{origin:'https://mizaelsouza12.github.io'}};
  const fetch=async()=>{throw new Error('offline');};
  vm.runInNewContext(sw,{self,caches:{match:async()=>null},fetch,URL,Response});
  handlers.fetch({
    request:{method:'GET',url:'https://mizaelsouza12.github.io/haroldobluesrep/setlists/a-sua-maneira.json'},
    respondWith:p=>{response=p;}
  });
  assert.equal((await response).status,503);
});
test('39: backup legado e renomeações preservam compatibilidade',()=>{
  const {w}=bootMain(createStorage());
  assert.ok(typeof w.eval('migrateBuiltinId')==='function');
  assert.ok(typeof w.eval('normalizeSetlist')==='function');
  assert.equal(w.eval('normalizeSetlist({name:"Test",songIds:[],songKeys:{}}).songIds.length'),0);
  w.close();
});
test('40: links publicados de repertório não exigem login',()=>{
  for(const page of [aHTML,jHTML]){
    assert.ok(!/oauth|github\.com\/login|supabase/i.test(page.toLowerCase()));
    assert.ok(page.includes('data-source='));
  }
});


test('41: normalização de acentos e IDs estáveis',()=>{
  const {w}=bootMain();
  assert.equal(w.eval("norm('ÁGUAS DE MARÇO')"),'aguas de marco');
  assert.equal(w.eval("stableSongId('A Feira','O Rappa')"),stableSongId('A Feira','O Rappa'));
  w.close();
});
test('42: pesquisa encontra música sem diferenciar acentos',()=>{
  const {w}=bootMain();
  input(w.document.getElementById('search'),'Aguas de Marco',w);
  assert.ok([...w.document.querySelectorAll('#list .t')].some(e=>e.textContent==='Águas de Março'));
  w.close();
});
test('43: renomear repertório muda aba e salva no navegador',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.prompt=()=> 'Meu Blues';
  w.eval("renameChip('J')");
  assert.ok([...w.document.querySelectorAll('#chips .chip')].some(e=>e.textContent==='Meu Blues'));
  assert.equal(JSON.parse(storage.getItem('repHaroldo_chipnames_v1')).J,'Meu Blues');
  w.close();
});
test('44: cancelar renomeação preserva nome',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.prompt=()=>null; w.eval("renameChip('A')");
  assert.equal(w.eval('CHIP_NAMES.A'),'A Sua Maneira');
  assert.equal(storage.getItem('repHaroldo_chipnames_v1'),null);
  w.close();
});
test('45: categoria personalizada é persistida',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.prompt=()=> 'Rock Nacional';
  w.document.querySelector('#catSeg .catAddBtn2').click();
  const categories=JSON.parse(storage.getItem('repHaroldo_customcats_v1'));
  assert.equal(categories.length,1);assert.equal(categories[0].name,'Rock Nacional');
  w.close();
});
test('46: criar letra personalizada preserva música base',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.eval('openEdit(null)');
  w.document.getElementById('inTitle').value='Teste de música nova';
  w.document.getElementById('inArtist').value='Artista de teste';
  w.document.getElementById('inLyrics').value='Letra de teste\nSegunda linha';
  w.document.querySelector('#catSeg [data-v="J"]').click();
  w.document.getElementById('saveSong').click();
  const records=JSON.parse(storage.getItem('repHaroldo_custom_v1'));
  assert.ok(records.some(s=>s.title==='Teste de música nova' && s.cats==='J'));
  assert.equal(w.eval('SONGS.length'),214);assert.equal(w.eval('ALL.length'),215);
  w.close();
});
test('47: edição da música base usa OVERRIDES sem alterar dados originais',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.eval('openEdit(ALL[0])');
  w.document.getElementById('inTitle').value='Título editado';
  w.document.getElementById('inLyrics').value='Nova letra de teste';
  w.document.getElementById('saveSong').click();
  const changes=JSON.parse(storage.getItem('repHaroldo_overrides_v1'));
  assert.ok(Object.values(changes).some(s=>s.title==='Título editado'));
  assert.equal(w.eval('SONGS.length'),214);
  w.close();
});
test('48: ocultar música remove da lista, não dos originais',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.eval('openActions(ALL[0])');
  w.document.getElementById('actHide').click();
  assert.equal(w.eval('ALL.length'),213);assert.equal(w.eval('SONGS.length'),214);
  assert.equal(JSON.parse(storage.getItem('repHaroldo_hidden_v1')).length,1);
  w.close();
});
test('49: confirmar seleção salva um setlist manual',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.prompt=()=> 'Show de sábado';
  w.document.getElementById('selectBtn').click();
  w.document.querySelector('#list .item').click();
  w.document.getElementById('selConfirm').click();
  const d=JSON.parse(storage.getItem('repHaroldo_setlists_v1'));
  assert.equal(d.list.length,1);assert.equal(d.list[0].name,'Show de sábado');
  assert.equal(d.list[0].songIds.length,1);
  w.close();
});
test('50: notas de repertórios A/J são independentes',()=>{
  const {w}=bootMain(createStorage());
  const songId=w.eval('SONGS.find(s=>s.title.includes("Sunshine")).id');
  w.eval("setSetlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(songId)+",'C')");
  w.eval("setSetlistKey(sharePlaylistSource(shareablePlaylists()[1]),"+JSON.stringify(songId)+",'D')");
  assert.equal(w.eval("setlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(songId)+")"),'C');
  assert.equal(w.eval("setlistKey(sharePlaylistSource(shareablePlaylists()[1]),"+JSON.stringify(songId)+")"),'D');
  w.close();
});


test('51: quantidade de músicas sem nota é calculada',()=>{
  const {w}=bootMain();
  assert.equal(w.eval('missingMusicianKeys(sharePlaylistSource(shareablePlaylists()[1]))'),19);
  w.close();
});
test('52: exportação de setlist vazio desabilita todos os botões',()=>{
  const {w}=bootMain();
  w.eval("openMusicianPrep({id:'vazio',name:'Vazio',songIds:[],songKeys:{}})");
  for(const id of ['musicianShare','musicianCopyLink','musicianPdf','musicianWord','musicianText'])
    assert.equal(w.document.getElementById(id).disabled,true);
  w.close();
});
test('53: link codificado conserva 19 músicas e título',()=>{
  const {w}=bootMain();
  // Os repertórios publicados usam links curtos; apenas setlists sem página publicada levam payload no hash.
  const link=w.eval("musicianLink({id:'STdynamic',name:'Jazz & Blues',songIds:shareablePlaylists()[1].songIds,songKeys:{}})");
  const coded=link.split('#d=')[1];assert.ok(coded);
  const decoded=JSON.parse(Buffer.from(coded,'base64url').toString('utf8'));
  assert.equal(decoded.s.length,19);assert.equal(decoded.n,'Jazz & Blues');
  assert.ok(!('text' in decoded));w.close();
});
test('54: nomes de arquivos são normalizados',()=>{
  const {w}=bootMain();
  assert.equal(w.eval("safeFileName('Á Sua Maneira & Rock/Jazz')"),'A-Sua-Maneira-Rock-Jazz');
  w.close();
});
test('55: conteúdo HTML é escapado para exportação',()=>{
  const {w}=bootMain();
  assert.equal(w.eval("htmlEsc('<script>\"&')"),'&lt;script&gt;&quot;&amp;');
  w.close();
});
test('56: escape e quebra de linhas do PDF',()=>{
  const {w}=bootMain();
  assert.equal(w.eval("pdfLatin('Olá – 世界')"),'Olá - ??');
  assert.ok(w.eval("pdfWrap('uma duas tres quatro cinco',10)").length>1);
  assert.ok(w.eval("pdfEscape('(x)')").includes('\\('));
  w.close();
});
test('57: PDF de Jazz & Blues tem cabeçalho, xref e rodapé válidos',()=>{
  const {w}=bootMain();
  const pdf=Buffer.from(w.eval('buildMusicianPdf(sharePlaylistSource(shareablePlaylists()[1]))')).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));assert.ok(pdf.includes('/Type /Pages'));
  assert.ok(pdf.includes('xref'));assert.ok(pdf.endsWith('%%EOF'));
  assert.ok(!pdf.includes('Watching the ships roll'));w.close();
});
test('58: PDF com 204 músicas gera mais de uma página',()=>{
  const {w}=bootMain();
  const pdf=Buffer.from(w.eval('buildMusicianPdf(sharePlaylistSource(shareablePlaylists()[0]))')).toString('latin1');
  const count=pdf.match(/\/Type \/Pages \/Count (\d+)/);assert.ok(count);
  assert.ok(Number(count[1])>=5);w.close();
});
test('59: distância textual e fuzzy search priorizam correspondência exata',()=>{
  const {w}=bootMain();
  assert.equal(w.eval("levenshtein('gato','pato')"),1);
  assert.equal(w.eval("scoreMatch('wonderwall','wonderwall')"),100);
  assert.equal(w.eval("bestMatchesFor('wonderwall')[0].s.title"),'Wonderwall');
  w.close();
});
test('60: abrir música e ajustar velocidade não alteram repertório',()=>{
  const {w}=bootMain();
  w.document.querySelector('#list .item').click();
  assert.ok(w.document.getElementById('songView').classList.contains('active'));
  const original=w.eval('curSong.id');
  const before=Number(w.document.getElementById('spdVal').textContent);
  w.document.getElementById('spdUp').click();
  assert.equal(Number(w.document.getElementById('spdVal').textContent),Math.min(150,before+2));
  assert.equal(w.eval('ALL.length'),214);assert.equal(w.eval('curSong.id'),original);
  w.close();
});


test('61: chave de anotação corrompida não impede backup das outras playlists',()=>{
  const storage=createStorage();
  storage.setItem('repHaroldo_musicianFields_v1:a-sua-maneira','{json-corrompido');
  storage.setItem('repHaroldo_musicianFields_v1:jazz-blues',JSON.stringify({SBteste:{key:'G',note:'Válida'}}));
  const {w}=bootMain(storage);
  const result=w.eval('exportMusicianFields()');
  assert.equal(result['a-sua-maneira'],undefined);
  assert.equal(result['jazz-blues'].SBteste.note,'Válida');
  w.close();
});


test('62: ocultar e restaurar música não deve apagar associação do setlist',()=>{
  const storage=createStorage(),{w}=bootMain(storage);
  w.eval("SETLISTS=[{id:'SThide',name:'Show',songIds:[ALL[0].id],songKeys:{}}];activeSetlistId='SThide';saveSetlists()");
  const id=w.eval('ALL[0].id');
  w.eval("HIDDEN.add("+JSON.stringify(id)+");saveHidden();rebuildAll()");
  w.eval("HIDDEN.delete("+JSON.stringify(id)+");saveHidden();rebuildAll()");
  assert.equal(w.eval("SETLISTS[0].songIds.includes("+JSON.stringify(id)+")"),true,
    'repor música temporariamente oculta deve preservar ordem e vínculo do setlist');
  w.close();
});
test('63: erro de gravação de letra deve permanecer na edição e mostrar aviso',()=>{
  const store=createStorage();
  const original=store.setItem.bind(store);
  store.setItem=(k,v)=>{
    if(k==='repHaroldo_custom_v1')throw new Error('QuotaExceededError');
    return original(k,v);
  };
  const {w}=bootMain(store);
  const warnings=[];w.alert=msg=>warnings.push(String(msg));
  w.eval('openEdit(null)');
  w.document.getElementById('inTitle').value='Letra de quota';
  w.document.getElementById('inLyrics').value='Não pode ser perdido';
  w.document.getElementById('saveSong').click();
  assert.equal(w.document.getElementById('editView').classList.contains('active'),true,
    'falha de gravação não pode fechar a tela com dados não salvos');
  assert.ok(warnings.some(x=>/salvar|armazenamento|espaço/i.test(x)));
  w.close();
});
test('64: repertórios publicados usam os links curtos verdadeiros',()=>{
  const {w}=bootMain();
  const links=w.eval("shareablePlaylists().slice(0,2).map(p=>musicianLink(sharePlaylistSource(p)))");
  assert.equal(links[0],'https://mizaelsouza12.github.io/haroldobluesrep/setlists/a-sua-maneira.html');
  assert.equal(links[1],'https://mizaelsouza12.github.io/haroldobluesrep/setlists/jazz-blues.html');
  w.close();
});


test('65: customização local corrompida não impede as 214 músicas originais de abrirem',()=>{
  const store=createStorage();
  store.setItem('repHaroldo_custom_v1',JSON.stringify([
    {id:42,title:123,artist:null,text:777,cats:'A'}
  ]));
  const {w}=bootMain(store);
  assert.equal(w.eval('SONGS.length'),214);
  assert.equal(w.eval('ALL.length'),214);
  w.close();
});
test('66: sem permissão de gravação, app não deve fingir que criou um setlist',()=>{
  const store=createStorage(),write=store.setItem.bind(store);
  store.setItem=(k,v)=>k==='repHaroldo_setlists_v1'
    ? (()=>{throw new Error('QuotaExceededError');})() : write(k,v);
  const {w}=bootMain(store);
  const alerts=[];w.alert=v=>alerts.push(String(v));w.prompt=()=> 'Show não salvo';
  w.document.getElementById('selectBtn').click();
  assert.equal(w.eval('selecting'),false,'não deve entrar na seleção sem gravar o setlist');
  assert.equal(w.eval('SETLISTS.length'),0);
  assert.ok(alerts.some(a=>/salvar|espaço|armazenamento/i.test(a)));
  w.close();
});
test('67: categorias personalizadas inválidas em storage não derrubam o app',()=>{
  const store=createStorage();
  store.setItem('repHaroldo_customcats_v1',JSON.stringify([
    null,{key:null,name:20},{key:'Xvalida',name:'Boa Categoria'}
  ]));
  const {w}=bootMain(store);
  w.document.getElementById('shareSetlistBtn').click();
  assert.ok(w.eval('CUSTOM_CATS.every(c=>c&&typeof c.key==="string"&&typeof c.name==="string")'));
  w.close();
});


test('68: ativação da PWA preserva caches de outros apps do mesmo domínio',async()=>{
  const handlers={},deleted=[];
  const self={addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim:async()=>{}},
    location:{origin:'https://mizaelsouza12.github.io'}};
  const caches={keys:async()=>['outro-projeto-offline','repertorio-haroldo-v1','repertorio-haroldo-v15'],
    delete:async key=>{deleted.push(key);return true;}};
  vm.runInNewContext(sw,{self,caches,fetch:()=>{},URL,Response});
  let task;handlers.activate({waitUntil:p=>task=p});await task;
  assert.deepEqual(deleted,['repertorio-haroldo-v1']);
});
test('69: ocultar música com storage indisponível não deve alterar lista visual',()=>{
  const store=createStorage(),old=store.setItem.bind(store);
  store.setItem=(k,v)=>k==='repHaroldo_hidden_v1'?(()=>{throw new Error('QuotaExceededError')})():old(k,v);
  const {w}=bootMain(store);const messages=[];w.alert=t=>messages.push(String(t));
  w.eval('openActions(ALL[0])');w.document.getElementById('actHide').click();
  assert.equal(w.eval('ALL.length'),214);
  assert.ok(messages.some(x=>/salvar|armazenamento|espaço/i.test(x)));
  w.close();
});
test('70: excluir música base sem armazenamento não deve sumir do repertório',()=>{
  const store=createStorage(),old=store.setItem.bind(store);
  store.setItem=(k,v)=>k==='repHaroldo_removed_v1'?(()=>{throw new Error('QuotaExceededError')})():old(k,v);
  const {w}=bootMain(store);w.confirm=()=>true;
  const messages=[];w.alert=t=>messages.push(String(t));
  w.eval('openActions(ALL[0])');w.document.getElementById('actDelete').click();
  assert.equal(w.eval('ALL.length'),214);
  assert.ok(messages.some(x=>/salvar|armazenamento|espaço/i.test(x)));
  w.close();
});
test('71: salvar nota no preparo falhando no localStorage sinaliza problema',()=>{
  const store=createStorage(),old=store.setItem.bind(store);
  store.setItem=(k,v)=>k==='repHaroldo_playlistkeys_v1'?(()=>{throw new Error('QuotaExceededError')})():old(k,v);
  const {w}=bootMain(store);const messages=[];w.alert=t=>messages.push(String(t));
  const p=w.eval('sharePlaylistSource(shareablePlaylists()[0])');
  const songId=w.eval('shareablePlaylists()[0].songIds[0]');
  w.eval("setSetlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(songId)+",'Bm')");
  assert.ok(messages.some(x=>/salvar|armazenamento|espaço/i.test(x)));
  assert.equal(w.eval("setlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(songId)+")"),'');
  w.close();
});
test('72: falha ao salvar categoria nova não deixa aba fantasma',()=>{
  const store=createStorage(),old=store.setItem.bind(store);
  store.setItem=(k,v)=>k==='repHaroldo_customcats_v1'?(()=>{throw new Error('QuotaExceededError')})():old(k,v);
  const {w}=bootMain(store),messages=[];w.alert=t=>messages.push(String(t));
  w.prompt=()=> 'Categoria não gravada';
  w.eval('openEdit(null)');
  w.document.querySelector('#catSeg .catAddBtn2').click();
  assert.equal(w.eval('CUSTOM_CATS.length'),0);
  assert.ok(messages.some(x=>/salvar|armazenamento|espaço/i.test(x)));
  w.close();
});


test('73: duas abas editando a mesma música não sobrescrevem sem aviso',async()=>{
  const store=createStorage();
  const a=await bootEditor('jazz-blues',store);
  const b=await bootEditor('jazz-blues',store);
  input(a.w.document.querySelector('.keyInput'),'C#m',a.w);
  input(b.w.document.querySelector('.keyInput'),'F',b.w);
  const fresh=await bootEditor('jazz-blues',store);
  assert.equal(fresh.w.document.querySelector('.keyInput').value,'C#m');
  assert.match(b.w.document.getElementById('saveStatus').textContent,/Conflito|alterada em outra aba/i);
  a.w.close();b.w.close();fresh.w.close();
});


test('74: override local malformado não impede inicializar repertório original',()=>{
  const store=createStorage();
  const id=stableSongId('15 Anos','Ira!');
  store.setItem('repHaroldo_overrides_v1',JSON.stringify({[id]:{title:42,artist:'Teste',text:'txt',cats:'A'}}));
  const {w}=bootMain(store);
  assert.equal(w.eval('ALL.length'),214);
  assert.ok(w.document.querySelectorAll('#list .item').length>0);
  w.close();
});
test('75: setlist local de nome inválido não derruba gerenciador',()=>{
  const store=createStorage();
  store.setItem('repHaroldo_setlists_v1',JSON.stringify({
    list:[{id:'STtest',name:{x:'não válido'},songIds:[],songKeys:{}}],
    active:'STtest'
  }));
  const {w}=bootMain(store);
  w.document.querySelector('#chips .chip').click();
  w.eval("openSetlistManager('manage')");
  assert.equal(w.document.querySelectorAll('#setlistMgrList .setlistRow').length,1);
  assert.equal(typeof w.eval('SETLISTS[0].name'),'string');
  w.close();
});


test('76: duas abas do aplicativo preparam notas distintas sem perda',()=>{
  const store=createStorage();
  const a=bootMain(store),b=bootMain(store);
  const ids=a.w.eval('shareablePlaylists()[0].songIds.slice(0,2)');
  a.w.eval("setSetlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(ids[0])+",'Ab')");
  b.w.eval("setSetlistKey(sharePlaylistSource(shareablePlaylists()[0]),"+JSON.stringify(ids[1])+",'C7')");
  const persisted=JSON.parse(store.getItem('repHaroldo_playlistkeys_v1'));
  assert.equal(persisted.A[ids[0]],'Ab');
  assert.equal(persisted.A[ids[1]],'C7');
  a.w.close();b.w.close();
});
