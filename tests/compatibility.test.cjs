'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {firefox,webkit}=require('playwright');
const engine=process.env.BROWSER_ENGINE||'firefox';
const ROOT=path.resolve(__dirname,'..');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
let server,base,browser;
before(async()=>{
  server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    let filename=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname));
    if(!filename.startsWith(ROOT+path.sep)){res.writeHead(403).end();return;}
    try{
      if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');
      res.writeHead(200,{'Content-Type':TYPES[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-store'});
      fs.createReadStream(filename).pipe(res);
    }catch(e){res.writeHead(404).end('Not Found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  base='http://127.0.0.1:'+server.address().port;
  browser=await ({firefox,webkit}[engine]).launch({headless:true});
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
async function setup(){
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true,serviceWorkers:'block'});
  const page=await context.newPage();
  const errs=[];page.on('pageerror',e=>errs.push(e.message));
  return {page,context,errs,close:()=>context.close()};
}
test(engine+' 01: site principal renderiza 214 músicas e filtros A/J',async()=>{
 const x=await setup();try{
  await x.page.goto(base+'/repertorio-haroldo.html');
  assert.equal(await x.page.locator('#list .item').count(),214);
  await x.page.locator('#chips .chip',{hasText:'A Sua Maneira'}).click();
  assert.equal(await x.page.locator('#list .item').count(),204);
  await x.page.locator('#chips .chip',{hasText:'Jazz & Blues'}).click();
  assert.equal(await x.page.locator('#list .item').count(),19);
  assert.deepEqual(x.errs,[]);
 }finally{await x.close();}
});
test(engine+' 02: teclado e recarga preservam tom e anotação',async()=>{
 const x=await setup();try{
  await x.page.goto(base+'/setlists/jazz-blues.html');
  await x.page.locator('.noteInput').first().waitFor();
  await x.page.locator('.keyInput').first().fill('F#');
  await x.page.locator('.noteInput').first().fill('Anotação WebKit/Firefox\nDa captação ao palco');
  await x.page.reload();
  await x.page.locator('.keyInput').first().waitFor();
  assert.equal(await x.page.locator('.keyInput').first().inputValue(),'F#');
  assert.match(await x.page.locator('.noteInput').first().inputValue(),/captação/);
  assert.deepEqual(x.errs,[]);
 }finally{await x.close();}
});
test(engine+' 03: os dois links de repertório separam as notas',async()=>{
 const x=await setup();try{
  await x.page.goto(base+'/setlists/a-sua-maneira.html');
  await x.page.locator('.keyInput').first().waitFor();
  await x.page.locator('.keyInput').first().fill('Am');
  assert.equal(await x.page.locator('.keyInput').count(),204);
  await x.page.goto(base+'/setlists/jazz-blues.html');
  await x.page.locator('.keyInput').first().waitFor();
  assert.equal(await x.page.locator('.keyInput').count(),19);
  assert.deepEqual(x.errs,[]);
 }finally{await x.close();}
});
test(engine+' 04: criação de letra e F5 recuperam rascunho',async()=>{
 const x=await setup();try{
  await x.page.goto(base+'/repertorio-haroldo.html');
  await x.page.locator('#addBtn').click();
  await x.page.locator('#inTitle').fill('Ensaio de compatibilidade');
  await x.page.locator('#inLyrics').fill('Uma letra com Unicode: João, coração, 🎵');
  await x.page.reload();
  await x.page.locator('#addBtn').click();
  assert.equal(await x.page.locator('#inTitle').inputValue(),'Ensaio de compatibilidade');
  assert.match(await x.page.locator('#inLyrics').inputValue(),/coração/);
  await x.page.locator('#saveSong').click();
  await x.page.reload();
  await x.page.locator('#search').fill('Ensaio de compatibilidade');
  assert.equal(await x.page.locator('#list .item').count(),1);
  assert.deepEqual(x.errs,[]);
 }finally{await x.close();}
});
test(engine+' 05: seletor mostra playlists originais e exportações disponíveis',async()=>{
 const x=await setup();try{
  await x.page.goto(base+'/repertorio-haroldo.html');
  await x.page.locator('#shareSetlistBtn').click();
  assert.equal(await x.page.locator('#setlistMgrList .shareChoice').count(),2);
  await x.page.locator('.shareChoice').last().click();
  assert.equal(await x.page.locator('.musicianKey').count(),19);
  for(const id of ['musicianCopyLink','musicianPdf','musicianWord','musicianText'])
    assert.equal(await x.page.locator('#'+id).isEnabled(),true);
  assert.deepEqual(x.errs,[]);
 }finally{await x.close();}
});
