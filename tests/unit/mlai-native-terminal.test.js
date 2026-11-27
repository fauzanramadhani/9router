import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { getMlaiNativeGrant } from '../../open-sse/services/mlaiNativeSession.js';
import { executeMlaiNativeGateway } from '../../open-sse/services/mlaiCodeNativeGateway.js';
import { MlaiCodeExecutor } from '../../open-sse/executors/mlai-code.js';
import { classifyMlaiNativeError } from '../../open-sse/services/mlaiNativeErrors.js';
const credentials = id => ({connectionId:id,accessToken:'mlaid_'+id,providerSpecificData:{mlaiNative:true}});
it.each([
 [409,{error:{message:'This run has ended'}},'run_closed'],
 [402,{error:{code:'run_finished'}},'billing_required'],
 [401,{error:{code:'run_finished'}},'authentication_required'],
 [403,{error:{code:'run_finished'}},'access_denied'],
 [429,{error:{code:'run_finished'}},'rate_limited'],
 [409,{error:{message:'private secret run_finished suffix'}},'upstream_error'],
 [409,{error:{code:'unknown_private_secret'}},'upstream_error'],
])('allowlists diagnostic %i without leaking raw fields',async(status,payload,code)=>{
 const grant={...grantValue(),endpoint:'https://code.ml.ai/api/model/v1'};
 proxyAwareFetch.mockResolvedValueOnce(Response.json(payload,{status,headers:{'Retry-After':'71'}}));
 const result=await executeMlaiNativeGateway({grant,body:{messages:[]}});
 expect(result.response.status).toBe(status);expect(result.response.headers.get('Retry-After')).toBe('71');
 const output=await result.response.json();expect(output.error.code).toBe(code);
 expect(JSON.stringify(output)).not.toMatch(/private|unknown_private/);
 expect(!!grant.terminal).toBe(code==='run_closed');expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});
it('does not leak a transport exception carrying status and private text',async()=>{
 proxyAwareFetch.mockRejectedValueOnce(Object.assign(new Error('private transport token'),{status:403,code:'private_code'}));
 const result=await new MlaiCodeExecutor().execute({credentials:credentials('transport-private'),body:{}});
 expect(await result.response.text()).not.toContain('private');
});
it('classifies bootstrap restrictions without raw body leaks or retry',async()=>{
 proxyAwareFetch.mockResolvedValueOnce(Response.json({error:{code:'private_secret',message:'private token'}},{status:402,headers:{'Retry-After':'30'}}));
 const result=await new MlaiCodeExecutor().execute({credentials:credentials('bootstrap-restricted'),body:{}});
 expect(result.response.status).toBe(402);expect(result.response.headers.get('Retry-After')).toBe('30');
 expect(await result.response.json()).toMatchObject({error:{code:'billing_required'}});expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
});
it('bounds oversized, malformed and stalled error bodies without closure inference',async()=>{
 for(const body of ['{bad private_secret',JSON.stringify({padding:'x'.repeat(8192),code:'run_finished'})]) {
  expect((await classifyMlaiNativeError(new Response(body,{status:409}))).code).toBe('upstream_error');
 }
 vi.useFakeTimers();const cancel=vi.fn();
 try {
  const pending=classifyMlaiNativeError(new Response(new ReadableStream({cancel}),{status:409}));
  await vi.advanceTimersByTimeAsync(1001);
  expect((await pending).code).toBe('upstream_error');expect(cancel).toHaveBeenCalledTimes(1);
 } finally {vi.useRealTimers();}
});
it('does not renew a terminal grant after its expiry',async()=>{
 const owner=credentials('closed-expiry');
 proxyAwareFetch.mockResolvedValueOnce(Response.json(grantValue())).mockResolvedValueOnce(Response.json({message:'This run has ended'},{status:409}));
 const executor=new MlaiCodeExecutor();await executor.execute({credentials:owner,body:{}});
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+7200000);
 const result=await executor.execute({credentials:owner,body:{}});
 expect(result.response.status).toBe(409);expect(await result.response.json()).toMatchObject({error:{code:'run_closed'}});
 expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});
const grantValue = () => ({gateway:'https://code.ml.ai/api/model/v1',token:'private-grant',expires:Date.now()+3600000,runId:'run-fixture',budget:{remaining:12}});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('retains run identity and budget on the connection-scoped grant',async()=>{
 proxyAwareFetch.mockResolvedValueOnce(Response.json(grantValue()));
 const grant=await getMlaiNativeGrant(credentials('metadata'));
 expect(grant.runId).toBe('run-fixture');expect(grant.budget).toEqual({remaining:12});
});
it('makes a confirmed closed but unexpired grant terminal without regrant or replay, isolated by credential',async()=>{
 const owner=credentials('closed');
 proxyAwareFetch.mockResolvedValueOnce(Response.json(grantValue())).mockResolvedValueOnce(Response.json({error:{message:'This run has ended'}},{status:409,headers:{'Retry-After':'45'}}));
 const executor=new MlaiCodeExecutor();
 const first=await executor.execute({body:{messages:[]},credentials:owner});
 expect(first.response.status).toBe(409);expect(first.response.headers.get('Retry-After')).toBe('45');
 expect(await first.response.json()).toMatchObject({error:{code:'run_closed'}});
 const second=await executor.execute({body:{messages:[]},credentials:owner});
 expect(second.response.status).toBe(409);
 expect(await second.response.text()).toMatch(/explicit.*new run/i);
 expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
 proxyAwareFetch.mockImplementation(async()=>Response.json(grantValue()));
 expect((await getMlaiNativeGrant(credentials('other'))).runId).toBe('run-fixture');
 expect((await getMlaiNativeGrant({...owner,accessToken:'mlaid_new_credential'})).runId).toBe('run-fixture');
 expect(proxyAwareFetch).toHaveBeenCalledTimes(4);
});
