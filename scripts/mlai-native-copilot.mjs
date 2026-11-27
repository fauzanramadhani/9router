// Local-only official-device gateway for a single operator's Copilot client.
// No cloud workspace, transcript files, emulated tools, or credentials in logs.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {executeMlaiNativeGateway} from '../open-sse/services/mlaiCodeNativeGateway.js';
const home=path.join(os.homedir(),'.mlai');
const port=Number(process.env.MLAI_COPILOT_PORT||20130);
const config=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Code/User/chatLanguageModels.json'),'utf8'));
const clientKey=config.find(x=>x.models?.some(m=>m.id==='mlai/main'))?.apiKey;
if(!clientKey)throw Error('Configure the Copilot custom endpoint API key first');
const project=process.env.MLAI_COPILOT_PROJECT_ID||crypto.randomUUID();
let grant=null,opening=null,tail=Promise.resolve(),requests=0;
const deviceHeaders=()=>({'Content-Type':'application/json','X-MLAI-Client':'laptop','X-MLAI-Version':'0.3.32','X-MLAI-Protocol':'1',Authorization:'Bearer '+fs.readFileSync(path.join(home,'.device-token'),'utf8').trim()});
async function getGrant(){
 if(grant&&grant.expires>Date.now()+60000)return grant;
 if(opening)return opening;
 opening=(async()=>{
  const res=await fetch('https://code.ml.ai/api/laptop',{method:'POST',headers:deviceHeaders(),body:JSON.stringify({action:'start',names:2,project,folderProject:project,folder:'Copilot-local',title:'Local Copilot native model session',run:{task:'Serve this local coding session through native model inference.',mode:'plan',model:'pixis-opus',effort:'low',engineCaps:1,requestId:crypto.randomUUID()}}),signal:AbortSignal.timeout(60000)});
  if(!res.ok){await res.body?.cancel();throw Object.assign(Error('Official device grant HTTP '+res.status),{status:res.status});}
  const v=await res.json();
  if(v.gateway!=='https://code.ml.ai/api/model/v1'||!v.token||!Number.isFinite(v.expires))throw Error('Invalid official gateway grant');
  grant={endpoint:v.gateway,token:v.token,expires:v.expires,model:'main'};
  console.log(JSON.stringify({event:'grant-ready',expires:v.expires,contextWindow:v.model?.contextWindow,engineModel:v.request?.model}));
  return grant;
 })().finally(()=>{opening=null;});return opening;
}
const authorize=req=>{const got=Buffer.from(req.headers.authorization||'');const expected=Buffer.from('Bearer '+clientKey);return got.length===expected.length&&crypto.timingSafeEqual(got,expected);};
const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'&&req.url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,requests,grantExpires:grant?.expires||null}));}
 const scopedPath='/'+clientKey+'/v1/chat/completions';
 if(req.method!=='POST'||!['/v1/chat/completions',scopedPath].includes(req.url)){res.writeHead(404);return res.end();}
 if(req.url!==scopedPath&&!authorize(req)){console.error(JSON.stringify({event:'local-auth-rejected',hasAuthorization:!!req.headers.authorization,receivedLength:(req.headers.authorization||'').length,expectedLength:('Bearer '+clientKey).length}));res.writeHead(401);return res.end();}
 let raw='';try{for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>8000000){res.writeHead(413);return res.end();}}}catch{return;}
 let b;try{b=JSON.parse(raw);}catch{res.writeHead(400);return res.end();}
 if(b.model!=='mlai/main'){res.writeHead(400);return res.end();}
 const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
 // Serialize distinct requests rather than replying busy409 and triggering retries.
 const work=async()=>{if(controller.signal.aborted)return;const t=Date.now();let first=null;
 try{const result=await executeMlaiNativeGateway({grant:await getGrant(),body:b,stream:b.stream,signal:controller.signal});
 res.writeHead(result.response.status,{'Content-Type':result.response.headers.get('content-type')||'application/json','Cache-Control':'no-cache'});
 for await(const c of result.response.body){first??=Date.now()-t;if(controller.signal.aborted)break;res.write(c);}res.end();requests++;
 console.log(JSON.stringify({event:'request',http:result.response.status,seconds:(Date.now()-t)/1000,firstByteMs:first,tools:b.tools?.length}));
 }catch(e){if(!res.headersSent)res.writeHead(e.status||502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'ML AI official device/gateway request failed. Check local logs or renew with mlai login.'}}));console.error(JSON.stringify({event:'request-failed',status:e.status||502,name:e.name}));}};
 tail=tail.then(work,work);
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'listening',address:'127.0.0.1',port})));
