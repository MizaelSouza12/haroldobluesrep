'use strict';
const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const ROOT=path.resolve(__dirname,'..');
const OUTPUT=path.join(ROOT,'artifacts');
fs.mkdirSync(OUTPUT,{recursive:true});
const load=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const main=load('repertorio-haroldo.html');
const editor=load('setlists/editor.js');
const viewer=load('setlist.html');
const sw=load('sw.js');
const re=/<script([^>]*)>([\s\S]*?)<\/script>/gi;
const js=[...main.matchAll(re)].filter(m=>!/type=['"]text\/plain['"]/i.test(m[1])).map(m=>m[2]).join('\n');
const viewJs=[...viewer.matchAll(re)].map(m=>m[2]).join('\n');
const parse=s=>acorn.parse(s,{ecmaVersion:'latest',sourceType:'script',locations:true});
function walk(node,fn){
  if(!node||typeof node!=='object')return;
  if(typeof node.type==='string')fn(node);
  for(const [k,v] of Object.entries(node)){
    if(['loc','start','end'].includes(k))continue;
    if(Array.isArray(v)){for(const x of v)if(x&&typeof x==='object')walk(x,fn);}
    else if(v&&typeof v==='object'&&typeof v.type==='string')walk(v,fn);
  }
}
const ast=parse(js),editorAst=parse(editor),viewAst=parse(viewJs),swAst=parse(sw);
function declarations(tree){
  const result=[];
  walk(tree,n=>{if(n.type==='FunctionDeclaration'&&n.id)
    result.push({name:n.id.name,startLine:n.loc.start.line,endLine:n.loc.end.line,lines:n.loc.end.line-n.loc.start.line+1});
  });
  return result.sort((a,b)=>a.startLine-b.startLine);
}
const functions={main:declarations(ast),editor:declarations(editorAst),viewer:declarations(viewAst),sw:declarations(swAst)};
const calls=new Map(),assign=[];
walk(ast,n=>{
  if(n.type==='CallExpression'&&n.callee?.type==='Identifier')
    calls.set(n.callee.name,(calls.get(n.callee.name)||0)+1);
  if(n.type==='AssignmentExpression'&&n.left?.type==='MemberExpression'&&n.left.property?.name==='innerHTML')
    assign.push({line:n.loc.start.line,kind:n.right?.type});
});
functions.main.forEach(f=>f.directCalls=calls.get(f.name)||0);
const ids=[...main.matchAll(/\bid=["']([^"']+)['"]/g)].map(m=>m[1]);
const set=new Set(ids),references=[...js.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1]);
const missing=[...new Set(references)].filter(id=>!set.has(id)&&id!=='updateBanner');
const buttons=[...main.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map(m=>({
  id:m[1].match(/\bid=["']([^"']+)/)?.[1]||'',
  text:m[2].replace(/<[^>]*>/g,'').trim().slice(0,80)
}));
const handlers=[...js.matchAll(/\$\(['"]([^'"]+)['"]\)\.onclick\s*=/g)].map(m=>m[1]);
const files=['repertorio-haroldo.html','setlists/editor.js','setlist.html','sw.js',
  'setlists/a-sua-maneira.html','setlists/jazz-blues.html','setlists/a-sua-maneira.json','setlists/jazz-blues.json'];
const report={createdAt:new Date().toISOString(),files:files.map(p=>({
 path:p,bytes:Buffer.byteLength(load(p)),lines:load(p).split('\n').length})),
 functions,DOM:{declaredIds:ids.length,distinctIds:set.size,buttonElements:buttons.length,
 explicitClickHandlers:handlers.length,missingIds:missing,buttons,
 innerHtmlAssignments:assign}};
fs.writeFileSync(path.join(OUTPUT,'code-review-inventory.json'),JSON.stringify(report,null,2));
let md='# Inventário AST do Repertório Haroldo\n\n';
md+='Inventário estrutural completo. **Ter a função no inventário não significa que ela foi exercitada em todos os ramos.**\n\n';
md+='Funções declaradas: app '+functions.main.length+', editor '+functions.editor.length+
 ', visualizador '+functions.viewer.length+', service worker '+functions.sw.length+'.\n';
md+='IDs do aplicativo: '+set.size+'. Botões HTML: '+buttons.length+'. Associações onclick explícitas: '+handlers.length+'.\n\n';
md+='## Função por função\n\n| Nome | Linha inicial do script | Linha final | Chamadas diretas |\n|---|---:|---:|---:|\n';
for(const f of functions.main)md+='| '+f.name+' | '+f.startLine+' | '+f.endLine+' | '+f.directCalls+' |\n';
md+='\nLinhas acima são relativas ao bloco JS. Chamadas como callbacks não aparecem como invocações diretas.\n\n';
md+='## Botões declarados\n\n| ID | Texto |\n|---|---|\n';
for(const b of buttons)md+='| '+(b.id||'(sem id)')+' | '+b.text.replace(/\|/g,'/')+' |\n';
md+='\n## Integridade estrutural\n';
md+='- IDs duplicados: '+(ids.length-set.size)+'\n';
md+='- Referências JS a IDs ausentes: '+(missing.length?missing.join(', '):'nenhuma')+'\n';
md+='- Atribuições innerHTML a revisar: '+assign.length+'\n';
md+='\n## Limitações confirmadas\n';
md+='- GitHub Pages não grava no servidor sem credenciais: notas e anotações ficam por navegador.\n';
md+='- Playlist nova no navegador não produz arquivo HTML no repositório automaticamente.\n';
md+='- Arquivos .doc gerados são HTML compatível, não DOCX.\n';
md+='- PDF usa caracteres Latin-1 e pode substituir símbolos Unicode.\n';
md+='- Letras do app principal continuam em repositório público.\n';
fs.writeFileSync(path.join(OUTPUT,'code-review-inventory.md'),md);
console.log(JSON.stringify({functionCounts:Object.fromEntries(Object.entries(functions).map(([k,v])=>[k,v.length])),
  ids:set.size,buttons:buttons.length,clickHandlers:handlers.length,missingIds:missing,innerHTML:assign.length},null,2));
if(missing.length)process.exitCode=1;
