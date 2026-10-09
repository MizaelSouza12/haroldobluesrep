'use strict';
// Verificação HTTP da produção publicada, independente de cache local,
// JSDOM e servidor HTTP dos testes. Use: npm run test:production
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE='https://mizaelsouza12.github.io/haroldobluesrep';
const paths=[
  '/repertorio-haroldo.html','/setlist.html',
  '/setlists/a-sua-maneira.html','/setlists/jazz-blues.html',
  '/setlists/a-sua-maneira.json','/setlists/jazz-blues.json',
  '/setlists/editor.js','/sw.js','/manifest.json'
];
async function fetchText(path){
  let last;
  for(let attempt=0;attempt<3;attempt++){
    try {
      const url=BASE+path+(path.includes('?')?'&':'?')+'smoke='+Date.now();
      const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
      assert.equal(response.status,200,'HTTP '+response.status+' em '+path);
      const content=await response.text();
      assert.ok(content.length>20,'Resposta vazia em '+path);
      return content;
    }catch(err){last=err;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}
  }
  throw new Error('Falha real de publicação em '+path+': '+last.message);
}
async function main(){
  const resources=await Promise.all(paths.map(fetchText));
  const data=Object.fromEntries(paths.map((p,i)=>[p,resources[i]]));
  assert.match(data['/repertorio-haroldo.html'],/id=["']songdata["']/i);
  for(const slug of ['a-sua-maneira','jazz-blues']){
    const html=data['/setlists/'+slug+'.html'];
    assert.ok(html.includes('editor.js'),'Editor não carregado no HTML de '+slug);
    assert.ok(html.includes('data-source="'+slug+'.json"'),'JSON incorreto na página '+slug);
  }
  const playlistA=JSON.parse(data['/setlists/a-sua-maneira.json']);
  const playlistJ=JSON.parse(data['/setlists/jazz-blues.json']);
  assert.equal(playlistA.songs.length,204);
  assert.equal(playlistJ.songs.length,19);
  assert.ok(data['/setlists/editor.js'].includes('localStorage'));
  const localWorker=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  const expectedVersion=(localWorker.match(/const CACHE_VERSION\s*=\s*'(v\d+)'/)||[])[1];
  assert.ok(expectedVersion,'Versão local de SW inválida');
  let publishedVersion=(data['/sw.js'].match(/const CACHE_VERSION\s*=\s*'(v\d+)'/)||[])[1];
  // Após deploy, CDNs podem propagar a nova versão em alguns segundos.
  // Aguarde até 32 s antes de denunciar regressão de publicação.
  for(let attempt=0;attempt<8 && publishedVersion!==expectedVersion;attempt++){
    await new Promise(resolve=>setTimeout(resolve,4000));
    const actual=await fetchText('/sw.js');
    publishedVersion=(actual.match(/const CACHE_VERSION\s*=\s*'(v\d+)'/)||[])[1];
  }
  assert.equal(publishedVersion,expectedVersion,'A versão publicada está defasada em relação à main');
  const manifest=JSON.parse(data['/manifest.json']);
  assert.ok(manifest.start_url);
  console.log('PRODUÇÃO CONFIRMADA:',BASE);
  console.log('HTTP 200:',paths.length,'recursos, A:',playlistA.songs.length,'J:',playlistJ.songs.length);
}
main().catch(err=>{console.error('PRODUÇÃO REPROVADA:',err.stack||err);process.exitCode=1;});
