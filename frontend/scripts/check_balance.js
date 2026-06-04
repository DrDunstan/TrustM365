const fs = require('fs');
const path = require('path');
const fp = path.join(__dirname, '..', 'src', 'pages', 'SecurityTemplates.jsx');
const s = fs.readFileSync(fp, 'utf8');
let paren=0, brac=0, brack=0;
let stack=[];
let inS=false,inD=false,inT=false,inSL=false,inML=false,esc=false;
let line=1;
for(let i=0;i<s.length;i++){
  const ch = s[i];
  const next = s[i+1];
  if (ch === '\n') { inSL=false; line++; continue; }
  if (inSL) { continue; }
  if (inML) { if (ch === '*' && next === '/') { inML=false; i++; } continue; }
  if (!inS && !inD && !inT && ch === '/' && next === '/') { inSL = true; i++; continue; }
  if (!inS && !inD && !inT && ch === '/' && next === '*') { inML = true; i++; continue; }
  if (!inD && !inT && ch === "'" && !inS) { inS = true; continue; }
  if (inS && ch === "'" && !esc) { inS = false; continue; }
  if (!inS && !inT && ch === '"' && !inD) { inD = true; continue; }
  if (inD && ch === '"' && !esc) { inD = false; continue; }
  if (!inS && !inD && ch === '`' && !inT) { inT = true; continue; }
  if (inT && ch === '`' && !esc) { inT = false; continue; }
  if (ch === '\\' && (inS || inD || inT)) { esc = !esc; continue; } else esc = false;
  if (inS || inD || inT) continue;
  if (ch === '(') { paren++; stack.push({ch:'(', line, index:i}); }
  else if (ch === ')') { if (paren === 0) console.log('Extra ) at', line); else { paren--; stack.pop(); } }
  else if (ch === '{') { brac++; stack.push({ch:'{', line, index:i}); }
  else if (ch === '}') { if (brac === 0) console.log('Extra } at', line); else { brac--; stack.pop(); } }
  else if (ch === '[') { brack++; stack.push({ch:'[', line, index:i}); }
  else if (ch === ']') { if (brack === 0) console.log('Extra ] at', line); else { brack--; stack.pop(); } }
}
console.log('paren',paren,'brac',brac,'brack',brack);
if (stack.length>0) {
  console.log('first unmatched', stack[0]);
  console.log('last unmatched', stack[stack.length-1]);
}
else console.log('All balanced (according to heuristic)');
