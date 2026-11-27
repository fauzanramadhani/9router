import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { getMlaiNativeGrant } from '../../open-sse/services/mlaiNativeSession.js';
import { DATA_DIR } from '../../src/lib/dataDir.js';
const owner = () => ({connectionId:randomUUID(),accessToken:'mlaid_'+randomUUID(),expiresAt:new Date(Date.now()+86400000).toISOString()});
const value = () => ({gateway:'https://code.ml.ai/api/model/v1', token:'secret-run', expires:Date.now()+3600000,runId:'run-test'});
const status = (extra={}) => ({runId:'run-test',running:false,budget:40000000,tokens:881345,calls:62,expires:Date.now()+3600000,...extra});
it('renews once after idle closed status on the same project with remaining allowance',async()=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));
 await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);
 proxyAwareFetch.mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json({...value(),token:'next-run'}));
 const grants=await Promise.all(Array.from({length:8},()=>getMlaiNativeGrant(c)));
 expect(grants.every(g=>g.token==='next-run')).toBe(true);
 expect(actions().map(a=>a.action)).toEqual(['start','status','start']);
 expect(actions()[2].project).toBe(actions()[0].project);
});
it('retries full body once only on structured run_finished after status confirms remaining allowance',async()=>{
 const {MlaiCodeExecutor}=await import('../../open-sse/executors/mlai-code.js');
 const c={...owner(),providerSpecificData:{mlaiNative:true}};
 const body={model:'mlai/main',messages:[{role:'system',content:'complete system'},{role:'user',content:'x'.repeat(90000)}],tools:[{type:'function',function:{name:'read',parameters:{type:'object',additionalProperties:false}}}],tool_choice:'auto'};
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(Response.json({error:{code:'run_finished'}},{status:409})).mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json({...value(),token:'next-run'})).mockResolvedValueOnce(Response.json({choices:[{message:{content:'ok'}}]}));
 const result=await new MlaiCodeExecutor().execute({credentials:c,model:'main',body});
 expect(result.response.status).toBe(200);
 expect(actions().map(a=>a.action||'inference')).toEqual(['start','inference','status','start','inference']);
 expect(actions()[1]).toEqual({...body,model:'main'});expect(actions()[4]).toEqual(actions()[1]);
});
it.each([
 ['quota',{budget:1,tokens:1}],['unknown',{running:null}],['identity',{runId:'other'}],['calls',{calls:null}],['expiry',{expires:null}]
])('does not admit on invalid or exhausted status %s',async(_,extra)=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+3600001);
 proxyAwareFetch.mockResolvedValueOnce(Response.json(status(extra)));
 await expect(getMlaiNativeGrant(c)).rejects.toMatchObject({code:'lifecycle_unverified'});
 expect(actions().map(a=>a.action)).toEqual(['start','status']);
});
it.each([401,402,403,409,429,500])('preserves status restriction %i without new run',async(code)=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);
 proxyAwareFetch.mockResolvedValueOnce(Response.json({error:{code:'run_finished'}},{status:code,headers:{'Retry-After':'17'}}));
 await expect(getMlaiNativeGrant(c)).rejects.toMatchObject({status:code,retryAfter:'17'});
 expect(actions().map(a=>a.action)).toEqual(['start','status']);
});
it('rejects expired device before status and isolates accounts and stable project rotation',async()=>{
 const c=owner();proxyAwareFetch.mockImplementation(async()=>Response.json(value()));
 await getMlaiNativeGrant(c);await getMlaiNativeGrant(owner());await getMlaiNativeGrant({...c,accessToken:'mlaid_rotated'});
 expect(actions()[0].project).toBe(actions()[2].project);expect(actions()[1].project).not.toBe(actions()[0].project);
 await expect(getMlaiNativeGrant({...c,expiresAt:new Date(1).toISOString()})).rejects.toMatchObject({status:401});
 expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
});
it('never replays a successful SSE response even if its body later fails',async()=>{
 const {MlaiCodeExecutor}=await import('../../open-sse/executors/mlai-code.js');
 const c={...owner(),providerSpecificData:{mlaiNative:true}};
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: first\n\n'));controller.error(new Error('stream failed'));}}),{headers:{'Content-Type':'text/event-stream'}}));
 const result=await new MlaiCodeExecutor().execute({credentials:c,body:{messages:[]},stream:true});
 expect(result.response.status).toBe(200);await expect(result.response.text()).rejects.toThrow();expect(actions().map(a=>a.action||'inference')).toEqual(['start','inference']);
});
it.each([409,401,402,403,429])('does not replay generic or restricted inference %i',async(code)=>{
 const {MlaiCodeExecutor}=await import('../../open-sse/executors/mlai-code.js');
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(Response.json({error:{code:code===409?'conflict':'run_finished'}},{status:code}));
 const result=await new MlaiCodeExecutor().execute({credentials:{...owner(),providerSpecificData:{mlaiNative:true}},body:{}});
 expect(result.response.status).toBe(code);expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});
it('does not admit on structured restrictions even with otherwise eligible status',async()=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);
 proxyAwareFetch.mockResolvedValueOnce(Response.json(status({error:{code:'quota_exceeded'}})));
 await expect(getMlaiNativeGrant(c)).rejects.toMatchObject({code:'lifecycle_unverified'});expect(actions().map(a=>a.action)).toEqual(['start','status']);
});
it('does not duplicate an ambiguously dispatched start after restart',async()=>{
 const c=owner();proxyAwareFetch.mockRejectedValueOnce(new Error('transport'));
 await expect(getMlaiNativeGrant(c)).rejects.toThrow();vi.resetModules();
 const restarted=await import('../../open-sse/services/mlaiNativeSession.js');
 await expect(restarted.getMlaiNativeGrant(c)).rejects.toMatchObject({code:'lifecycle_unverified'});
 expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});
it('bounds second run_finished to one renewal and one replay',async()=>{
 const {MlaiCodeExecutor}=await import('../../open-sse/executors/mlai-code.js');const c={...owner(),providerSpecificData:{mlaiNative:true}};
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(Response.json({code:'run_finished'},{status:409})).mockResolvedValueOnce(Response.json(status())).mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(Response.json({code:'run_finished'},{status:409}));
 expect((await new MlaiCodeExecutor().execute({credentials:c,body:{}})).response.status).toBe(409);
 expect(proxyAwareFetch).toHaveBeenCalledTimes(5);
});
it('never renews a restricted grant on a later idle request',async()=>{
 const {MlaiCodeExecutor}=await import('../../open-sse/executors/mlai-code.js');const c={...owner(),providerSpecificData:{mlaiNative:true}};
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value())).mockResolvedValueOnce(Response.json({error:{code:'quota_exceeded'}},{status:429,headers:{'Retry-After':'31'}}));
 const executor=new MlaiCodeExecutor();await executor.execute({credentials:c,body:{}});
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);
 const result=await executor.execute({credentials:c,body:{}});expect(result.response.status).toBe(429);expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});
it('serializes admission across independent module instances',async()=>{
 const c=owner();vi.resetModules();const second=await import('../../open-sse/services/mlaiNativeSession.js');
 proxyAwareFetch.mockImplementation(async(_url,o)=>JSON.parse(o.body).action==='status'?Response.json(status({running:true})):Response.json(value()));
 const grants=await Promise.all([getMlaiNativeGrant(c),second.getMlaiNativeGrant(c)]);
 expect(grants.map(g=>g.token)).toEqual(['secret-run','secret-run']);expect(actions().filter(a=>a.action==='start')).toHaveLength(1);
});
it('bounds stalled status body without starting a replacement',async()=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+61000);vi.useFakeTimers();
 proxyAwareFetch.mockResolvedValueOnce(new Response(new ReadableStream()));
 const pending=getMlaiNativeGrant(c);const assertion=expect(pending).rejects.toMatchObject({code:'lifecycle_unverified'});
 await vi.advanceTimersByTimeAsync(61000);await assertion;vi.useRealTimers();expect(actions().map(a=>a.action)).toEqual(['start','status']);
});
it('renews an expired grant after confirmed closure with an unexpired device',async()=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));await getMlaiNativeGrant(c);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+3600001);
 proxyAwareFetch.mockResolvedValueOnce(Response.json(status({expires:now+3600000}))).mockResolvedValueOnce(Response.json({...value(),token:'replacement'}));
 expect((await getMlaiNativeGrant(c)).token).toBe('replacement');expect(actions().map(a=>a.action)).toEqual(['start','status','start']);
});
it('retains a definitive bootstrap restriction rather than an ambiguous admission lockout',async()=>{
 const c=owner();proxyAwareFetch.mockResolvedValueOnce(Response.json({error:{code:'limited'}},{status:429,headers:{'Retry-After':'22'}}));
 await expect(getMlaiNativeGrant(c)).rejects.toMatchObject({status:429});vi.resetModules();const restarted=await import('../../open-sse/services/mlaiNativeSession.js');
 await expect(restarted.getMlaiNativeGrant(c)).rejects.toMatchObject({status:429,retryAfter:'22'});expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});
const actions = () => proxyAwareFetch.mock.calls.map(([,o])=>JSON.parse(o.body));
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('resumes encrypted persisted grant after restart using read-only status without duplicate admission',async()=>{
 const credential=owner();
 proxyAwareFetch.mockResolvedValueOnce(Response.json(value()));
 await getMlaiNativeGrant(credential);
 vi.resetModules();
 proxyAwareFetch.mockResolvedValueOnce(Response.json(status({running:true})));
 const restarted=await import('../../open-sse/services/mlaiNativeSession.js');
 expect((await restarted.getMlaiNativeGrant(credential)).token).toBe('secret-run');
 expect(actions().map(a=>a.action)).toEqual(['start','status']);
 expect(actions()[1]).toEqual({action:'status'});
 expect(proxyAwareFetch.mock.calls[1][0]).toBe('https://code.ml.ai/api/laptop');
 expect(proxyAwareFetch.mock.calls[1][1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer secret-run'}});
 expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer '+credential.accessToken);
 const hash=s=>createHash('sha256').update(s).digest('hex');
 for(const file of [hash(credential.connectionId+':'+hash(credential.accessToken))+'.json']) {
  expect(readFileSync(join(DATA_DIR,'mlai-native-sessions',file),'utf8')).not.toMatch(/mlaid_|secret-run|run-test/);
 }
});
