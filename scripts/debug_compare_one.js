const http = require('http');
function req(method, path, data){return new Promise((resolve,reject)=>{let body=data?JSON.stringify(data):null;const options={hostname:'127.0.0.1',port:3001,path,method,headers:{}};if(body){options.headers['Content-Type']='application/json';options.headers['Content-Length']=Buffer.byteLength(body);}const r=http.request(options,(res)=>{let out='';res.setEncoding('utf8');res.on('data',c=>out+=c);res.on('end',()=>{try{resolve(JSON.parse(out));}catch(e){resolve(out);}});});r.on('error',reject);if(body)r.write(body);r.end();});}
async function run(tplId){const tenant='3c1b8875-f88f-4367-93a1-06b9cf42ddc9';const tpl=await req('GET',`/api/reference-templates/${encodeURIComponent(tplId)}`);console.log('Template watched_keys:',tpl.watched_keys);
const live=await req('GET',`/api/areas/${tenant}/${encodeURIComponent(tpl.area_key)}/live`);console.log('Live resources count:',Object.keys(live.resources||{}).length);
for(const wk of (tpl.watched_keys||[])){
  const path=wk.path;const refVal=(function(){const parts=String(path).split('.');let cur=tpl.resources && Object.values(tpl.resources)[0];for(const p of parts){if(cur===undefined||cur===null) {cur=undefined;break;} if(Array.isArray(cur)&&/^[0-9]+$/.test(p)){cur=cur[Number(p)];} else {cur=cur[p];}}return cur;})();
  console.log('\nWatched key:',path,'refVal=',JSON.stringify(refVal));
  for(const [id,lres] of Object.entries(live.resources||{})){
    const parts=String(path).split('.');let cur=lres;for(const p of parts){if(cur===undefined||cur===null){cur=undefined;break;} if(Array.isArray(cur)&&/^[0-9]+$/.test(p)){cur=cur[Number(p)];} else {cur=cur[p];}}console.log('  live',id,'=>',JSON.stringify(cur));
  }
}
console.log('\nPosting compare with currentResources...');
const cmp=await req('POST',`/api/reference-templates/${encodeURIComponent(tplId)}/compare`,{currentResources:live.resources,scan:true,tenantId:tenant});console.log('Compare result:',JSON.stringify(cmp, null, 2));}
run(process.argv[2]).catch(e=>{console.error(e);process.exit(1);});
