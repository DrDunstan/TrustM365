const fs = require('fs');
const path = process.argv[2] || 'frontend/src/pages/ReferenceTemplates.jsx';
const src = fs.readFileSync(path, 'utf8');

function locAt(idx) {
  const lines = src.slice(0, idx).split(/\r?\n/);
  return { line: lines.length, col: lines[lines.length-1].length + 1 };
}

let inSingle=false, inDouble=false, inTemplate=false, inLine=false, inBlock=false;
let depth=0;
let firstNegative=null;
let returnsOutside=[];
let functionStartIndex=-1, functionBraceStart=-1, functionBraceEnd=-1;
const funcName = 'export default function ReferenceTemplates';
const found = src.indexOf(funcName);
if(found!==-1) {
  functionStartIndex = found;
  // find '(' after function name
  const parenIdx = src.indexOf('(', found);
  // find matching ')' for params
  let pDepth=0; let pClose=-1;
  for(let i=parenIdx;i<src.length;i++){
    if(src[i]==='(') pDepth++;
    else if(src[i]===')'){ pDepth--; if(pDepth===0){ pClose=i; break }}
  }
  if(pClose!=-1){
    // find next '{'
    const bIdx = src.indexOf('{', pClose);
    if(bIdx!==-1) functionBraceStart = bIdx;
  }
}

for(let i=0;i<src.length;i++){
  const ch = src[i];
  const next = src[i+1];
  if(inLine){ if(ch==='\n') inLine=false; }
  else if(inBlock){ if(ch==='*' && next==='/'){ inBlock=false; i++; continue } }
  else if(inSingle){ if(ch==='\\') i++; else if(ch==="'") inSingle=false; }
  else if(inDouble){ if(ch==='\\') i++; else if(ch==='"') inDouble=false; }
  else if(inTemplate){ if(ch==='\\') i++; else if(ch==='`') inTemplate=false; }
  else {
    if(ch==='/' && next==='/' ){ inLine=true; i++; continue }
    if(ch==='/' && next==='*'){ inBlock=true; i++; continue }
    if(ch==="'") { inSingle=true; continue }
    if(ch==='"') { inDouble=true; continue }
    if(ch==='`') { inTemplate=true; continue }
    if(ch==='{'){ depth++; }
    else if(ch==='}'){
      depth--; if(depth<0 && firstNegative===null) firstNegative={idx:i, loc: locAt(i)};
      // if this closes the function body
      if(functionBraceStart!==-1 && functionBraceEnd===-1 && i>functionBraceStart && depth===0){ functionBraceEnd=i; }
    }
    // detect 'return' tokens when not in string/comment
    if(ch==='r' && src.slice(i,i+6)==='return' ){
      // ensure word boundary
      const before = src[i-1]; const after = src[i+6];
      const isWordBefore = before && /[A-Za-z0-9_$]/.test(before);
      const isWordAfter = after && /[A-Za-z0-9_$]/.test(after);
      if(!isWordBefore && !isWordAfter){
        if(depth===0) returnsOutside.push({idx:i, loc: locAt(i)});
      }
    }
  }
}

console.log('file:', path);
if(functionStartIndex!==-1) console.log('function start at', locAt(functionStartIndex));
if(functionBraceStart!==-1) console.log('function body brace at', locAt(functionBraceStart));
if(functionBraceEnd!==-1) console.log('function body closing brace at', locAt(functionBraceEnd));
else console.log('function body closing brace: NOT FOUND');
console.log('final depth:', depth);
if(firstNegative) console.log('first negative brace at', firstNegative.loc);
if(returnsOutside.length>0){
  console.log('return tokens found at depth 0 (outside functions):');
  returnsOutside.forEach(r=>console.log('-', r.loc));
} else console.log('no return outside functions detected');

// Print a small snippet around function brace start and around the first return outside if present
if(functionBraceStart!==-1){
  const startLine = Math.max(1, locAt(functionBraceStart).line-3);
  const lines = src.split(/\r?\n/);
  console.log('\n--- context around function body start (line '+locAt(functionBraceStart).line+') ---');
  console.log(lines.slice(startLine-1, startLine+6).join('\n'));
}
if(returnsOutside.length>0){
  const r = returnsOutside[0];
  const line = r.loc.line;
  const lines = src.split(/\r?\n/);
  console.log('\n--- context around first return outside (line '+line+') ---');
  console.log(lines.slice(Math.max(0,line-4), line+3).join('\n'));
}
