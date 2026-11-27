import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { MlaiCodeExecutor } from '../../open-sse/executors/mlai-code.js';

describe('ML AI native connection dispatch', () => {
 it('does not reuse a grant across connections or renewed credentials', async () => {
  const executor=new MlaiCodeExecutor();
  proxyAwareFetch.mockImplementation(async (url,options)=>url.endsWith('/laptop')?Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'grant-'+options.headers.Authorization,expires:Date.now()+3600000}):Response.json({choices:[]}));
  for(const [connectionId,accessToken] of [['scope-a','mlaid_a'],['scope-a','mlaid_a'],['scope-b','mlaid_b'],['scope-a','mlaid_renewed']]) {
   const result=await executor.execute({model:'main',body:{messages:[{role:'user',content:'hi'}]},stream:false,credentials:{connectionId,accessToken,providerSpecificData:{mlaiNative:true}}});
   expect(result.response.status).toBe(200);
  }
  expect(proxyAwareFetch.mock.calls.filter(([url])=>url.endsWith('/laptop'))).toHaveLength(3);
 });
 it.each([401,403,429])('preserves native restriction %i and Retry-After without retrying bootstrap',async status=>{
  proxyAwareFetch.mockResolvedValueOnce(new Response('private upstream token',{status,headers:{'Retry-After':'120'}}));
  const result=await new MlaiCodeExecutor().execute({model:'main',body:{messages:[]},credentials:{connectionId:'restricted-'+status,accessToken:'mlaid_restricted',providerSpecificData:{mlaiNative:true}}});
  expect(result.response.status).toBe(status);
  expect(await result.response.text()).not.toContain('private upstream token');
  expect(result.response.headers.get('Retry-After')).toBe('120');
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
 });
 it('rejects expired device credentials before bootstrap',async()=>{
  const result=await new MlaiCodeExecutor().execute({body:{},credentials:{connectionId:'expired',accessToken:'mlaid_old',expiresAt:new Date(0).toISOString(),providerSpecificData:{mlaiNative:true}}});
  expect(result.response.status).toBe(401);expect(proxyAwareFetch).not.toHaveBeenCalled();
 });

 it('reuses an unexpired grant without speculative early renewal',async()=>{
  const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
  const credentials={connectionId:'renewal',accessToken:'mlaid_renewal',providerSpecificData:{mlaiNative:true}};
  const args={model:'main',body:{messages:[{role:'user',content:'hi'}]},credentials,stream:false};
  const grant=()=>Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'run-renewal',expires:Date.now()+120000});
  proxyAwareFetch.mockImplementation(async (url,o)=>url.endsWith('/laptop')?(JSON.parse(o.body).action==='status'?Response.json({runId:'renewal-run',running:true,budget:100,tokens:1,calls:1,expires:now+120000}):Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'run-renewal',runId:'renewal-run',expires:now+120000})):Response.json({choices:[]}));
  try {
   const executor=new MlaiCodeExecutor();await executor.execute(args);
   vi.mocked(Date.now).mockReturnValue(now+70000);await executor.execute(args);
   const starts=proxyAwareFetch.mock.calls.filter(([url,o])=>url.endsWith('/laptop')&&JSON.parse(o.body).action==='start');
   expect(starts).toHaveLength(1);
   expect(proxyAwareFetch.mock.calls.filter(([url,o])=>url.endsWith('/laptop')&&JSON.parse(o.body).action==='status')).toHaveLength(1);expect(proxyAwareFetch.mock.calls.filter(([url])=>url.endsWith('/chat/completions'))).toHaveLength(2);
  }finally{vi.restoreAllMocks();}
 });
 it('preserves gateway Retry-After without regrant or replay',async()=>{
  proxyAwareFetch.mockResolvedValueOnce(Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'run-limited',expires:Date.now()+3600000})).mockResolvedValueOnce(new Response('secret',{status:429,headers:{'Retry-After':'90'}}));
  const result=await new MlaiCodeExecutor().execute({body:{messages:[]},credentials:{connectionId:'gateway-limited',accessToken:'mlaid_limit',providerSpecificData:{mlaiNative:true}}});
  expect(result.response.status).toBe(429);expect(result.response.headers.get('retry-after')).toBe('90');expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
 });
 beforeEach(() => vi.resetAllMocks());
 it('uses the selected connection device credential and preserves complete request and SSE bytes', async () => {
  proxyAwareFetch.mockResolvedValueOnce(Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'run-test',expires:Date.now()+3600000})).mockResolvedValueOnce(new Response('data: native\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
  const body={messages:[{role:'system',content:'s'.repeat(220000)},{role:'user',content:'hello'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object',additionalProperties:false}}}],tool_choice:'required',stream_options:{include_usage:true}};
  const result=await new MlaiCodeExecutor().execute({model:'main',body,stream:true,credentials:{connectionId:'native-a',accessToken:'mlaid_test-a',expiresAt:new Date(Date.now()+3600000).toISOString(),providerSpecificData:{mlaiNative:true}}});
  expect(result.response.status).toBe(200);
  expect(await result.response.text()).toBe('data: native\n\ndata: [DONE]\n\n');
  expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
  expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer mlaid_test-a');
  expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toEqual({...body,model:'main',stream:true});
 });
});
