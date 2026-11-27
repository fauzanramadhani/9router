import { createHash, randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../src/lib/dataDir.js';
import { proxyAwareFetch } from '../utils/proxyFetch.js';
import { classifyMlaiNativeError, MlaiNativeError, RUN_CLOSED_MESSAGE } from './mlaiNativeErrors.js';

// Private encrypted state is scoped to a connection AND device credential. The device
// credential is already persisted by router OAuth; derive the encryption key from it,
// so no additional plaintext bearer or key is written to disk.
const sessions = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');
async function laptopRequest(token, body, signal, proxyOptions) {
 const controller=new AbortController();let timer;
 let abort;
 const failure=()=>new MlaiNativeError(502,'Native lifecycle request could not be verified','lifecycle_unverified');
 try {
  const stopped=new Promise((_,reject)=>{
   timer=setTimeout(()=>{controller.abort();reject(failure());},60000);
   abort=()=>{controller.abort();reject(signal.reason||failure());};
   if(signal?.aborted) abort();else signal?.addEventListener('abort',abort,{once:true});
  });
  const work=(async()=>{
   const response=await proxyAwareFetch('https://code.ml.ai/api/laptop',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-MLAI-Client':'laptop','X-MLAI-Version':'0.3.32','X-MLAI-Protocol':'1'},body:JSON.stringify(body),signal:controller.signal},proxyOptions);
   if(!response.ok){const d=await classifyMlaiNativeError(response);throw new MlaiNativeError(response.status,d.message,d.code,response.headers.get('retry-after'));}
   const reader=response.body.getReader();const chunks=[];let size=0;
   try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw failure();chunks.push(Buffer.from(value));}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
   } finally {void reader.cancel().catch(()=>{});}
  })();
  return await Promise.race([work,stopped]);
 } catch(error) {if(error instanceof MlaiNativeError || signal?.aborted)throw error;throw failure();}
 finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function storage(credentials) {
 const scope = hash(credentials.connectionId + ':' + hash(credentials.accessToken));
 const key = createHash('sha256').update('9router-native-state-v1:' + credentials.accessToken).digest();
 const directory = join(DATA_DIR, 'mlai-native-sessions');
 mkdirSync(directory, {recursive:true,mode:0o700});
 const file = join(directory, scope + '.json');
 return {
  async lock(signal) {
   for(let attempt=0;attempt<600;attempt++) {
    signal?.throwIfAborted();
    try { writeFileSync(file+'.lock',String(process.pid),{flag:'wx',mode:0o600}); return ()=>unlinkSync(file+'.lock'); }
    catch(error) {
     if(error.code!=='EEXIST') throw new MlaiNativeError(409,'Native lifecycle storage unavailable','lifecycle_unverified');
     try { const pid=Number(readFileSync(file+'.lock','utf8')); if(Number.isInteger(pid)&&pid>0) { try {process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){unlinkSync(file+'.lock');continue;}} } } catch {}
     await new Promise(resolve=>setTimeout(resolve,100));
    }
   }
   throw new MlaiNativeError(409,'Native lifecycle is busy','lifecycle_busy');
  },
  load() {
   try {
    const {iv,tag,data} = JSON.parse(readFileSync(file,'utf8'));
    const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));
    decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(Buffer.from(tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString());
   } catch(error) { if(error.code==='ENOENT') return null; throw new MlaiNativeError(409,'Native lifecycle state could not be verified','lifecycle_unverified'); }
  },
  save(value) {
   const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
   cipher.setAAD(Buffer.from(scope));
   const data=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
   const temp=file+'.'+randomUUID()+'.tmp';
   writeFileSync(temp,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600,flag:'wx'});
   renameSync(temp,file);
  }
 };
}
export async function getMlaiNativeGrant(credentials, { signal, proxyOptions = null } = {}) {
 const token = credentials?.accessToken;
 const fail = (status, message) => { throw new MlaiNativeError(status, message); };
 if (!credentials?.connectionId || typeof token !== 'string' || !token.startsWith('mlaid_')) fail(401, 'Native device login required');
 const expiry = Date.parse(credentials.expiresAt);
 if (Number.isFinite(expiry) && expiry <= Date.now()) fail(401, 'Device login expired; reconnect ML AI native login');
 const key = credentials.connectionId + ':' + createHash('sha256').update(token).digest('hex');
 let session = sessions.get(key);
 if (!session) {
  // Connection IDs are router-owned; client bodies never select project ownership.
  const digest = createHash('sha256').update('9router-native-project:' + credentials.connectionId).digest('hex');
  const project = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const store = storage(credentials);
  session = { project, grant:null, pending:null, store, needsStatus:true };
  sessions.set(key, session);
 }
 if (session.pending) return session.pending;
 if(session.blocked) {const b=session.blocked;throw new MlaiNativeError(b.status,b.message,b.code,b.retryAfter);}
 if(session.admissionPending) throw new MlaiNativeError(409,'Native admission outcome is unknown','lifecycle_unverified');
 if(session.grant?.blocked) { const b=session.grant.blocked; throw new MlaiNativeError(b.status,b.message,b.code,b.retryAfter); }
 if (session.grant?.terminal && !session.grant.renewable) throw new MlaiNativeError(409,RUN_CLOSED_MESSAGE,'run_closed');
 if (session.grant && !session.needsStatus && !session.grant.terminal && session.grant.expires>Date.now() && Date.now()-session.lastUsed<60000) { session.lastUsed=Date.now(); return session.grant; }
 session.pending = (async () => {
 const release=await session.store.lock(signal);
 try {
 const saved=session.store.load();
 if(saved?.blocked) {session.blocked=saved.blocked;const b=saved.blocked;throw new MlaiNativeError(b.status,b.message,b.code,b.retryAfter);}
 if(saved?.admissionPending) throw new MlaiNativeError(409,'Native admission outcome is unknown; inspect existing run','lifecycle_unverified');
 if(saved?.grant) session.grant=saved.grant;
 if(session.grant) session.grant.persist=()=>session.store.save({project:session.project,grant:session.grant});
 if(session.grant?.blocked) {const b=session.grant.blocked;throw new MlaiNativeError(b.status,b.message,b.code,b.retryAfter);}
 if(session.grant?.terminal&&!session.grant.renewable) throw new MlaiNativeError(409,RUN_CLOSED_MESSAGE,'run_closed');
 if (session.grant) {
  // Official status uses the run bearer; readOnly is a client option, not wire JSON.
  const status=await laptopRequest(session.grant.token,{action:'status'},signal,proxyOptions);
  const valid = status && Object.keys(status).every(k=>['runId','running','budget','tokens','calls','expires'].includes(k)) && typeof status.running==='boolean' && status.runId===session.grant.runId && ['budget','tokens','calls','expires'].every(k=>Number.isFinite(status[k]) && status[k]>=0);
  if(!valid) throw new MlaiNativeError(409,'Native run status could not be verified','lifecycle_unverified');
  if(status.running && session.grant.expires>Date.now() && !session.grant.terminal) {
   session.needsStatus=false; session.lastUsed=Date.now(); return session.grant;
  }
  if(status.running || !(status.budget>status.tokens) || !Number.isFinite(expiry) || expiry<=Date.now()) throw new MlaiNativeError(409,'Native run is not eligible for automatic continuation','lifecycle_unverified');
 }
  // Persist only a genuinely ambiguous in-flight admission, never a permanent
  // success marker. A confirmed response replaces this state with the resumable grant.
  session.admissionPending=true;
  session.store.save({project:session.project,grant:session.grant,admissionPending:true});
  const value = await laptopRequest(token,{ action: 'start', names: 2, project: session.project, folderProject: session.project, folder: '9router-native', title: '9router native inference', run: { task: 'Serve this coding session through native model inference.', mode: 'plan', model: 'pixis-opus', effort: 'low', engineCaps: 1, requestId: randomUUID() } },signal,proxyOptions);
  if (value.gateway !== 'https://code.ml.ai/api/model/v1' || typeof value.token !== 'string' || !value.token || !Number.isFinite(value.expires) || value.expires <= Date.now()) fail(502, 'Invalid native gateway grant');
  session.grant = { endpoint: value.gateway, token: value.token, expires: value.expires, model: 'main', runId: value.runId, budget: value.budget };
  session.needsStatus=false; session.lastUsed=Date.now(); session.admissionPending=false;
  session.grant.persist=()=>session.store.save({project:session.project,grant:session.grant});
  session.store.save({project:session.project,grant:session.grant});
  return session.grant;
 } catch(error) {
  if(error instanceof MlaiNativeError && [401,402,403,429].includes(error.status)) {
   session.blocked={status:error.status,message:error.message,code:error.code,retryAfter:error.retryAfter};session.admissionPending=false;
   session.store.save({project:session.project,grant:session.grant,blocked:session.blocked});
  }
  throw error;
 } finally {release();}
 })().finally(() => { session.pending = null; });
 return session.pending;
}
