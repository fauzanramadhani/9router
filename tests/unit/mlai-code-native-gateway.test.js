import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js',()=>({proxyAwareFetch:(...args)=>globalThis.fetch(...args)}));
import {executeMlaiNativeGateway} from '../../open-sse/services/mlaiCodeNativeGateway.js';
const grant={endpoint:'https://code.ml.ai/api/model/v1',token:'unit-run-token',expires:Date.now()+60000,model:'main'};
afterEach(()=>vi.unstubAllGlobals());
it.each(['pixis','pixis-opus','pixis-sol'])('gateway rejects removed request model %s',async model=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const result=await executeMlaiNativeGateway({grant,body:{model,messages:[]}});
 expect(result.response.status).toBe(400);expect(fetch).not.toHaveBeenCalled();
});
it('forwards full native tools and transcript without task serialization or nonce emulation',async()=>{
 const body={model:'main',messages:[{role:'system',content:'S'.repeat(160000)},{role:'user',content:'build'}],tools:[{type:'function',function:{name:'create',parameters:{type:'object',additionalProperties:false}}}],tool_choice:'auto',stream:true,stream_options:{include_usage:true}};
 const wire='data: {"choices":[{"delta":{"tool_calls":[{"id":"real","function":{"name":"create","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
 const fetch=vi.fn(async()=>new Response(wire,{headers:{'content-type':'text/event-stream'}}));vi.stubGlobal('fetch',fetch);
 const result=await executeMlaiNativeGateway({grant,body,stream:true});
 expect(await result.response.text()).toBe(wire);expect(fetch).toHaveBeenCalledOnce();
 const [url,init]=fetch.mock.calls[0];expect(url).toBe(grant.endpoint+'/chat/completions');expect(JSON.parse(init.body)).toEqual({...body,model:'main'});expect(result.headers).not.toHaveProperty('Authorization');
});
it.each([{...grant,expires:0},{...grant,endpoint:'https://other.test/api/model/v1'},{...grant,token:''}])('rejects invalid/expired trusted grants before network',async bad=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const result=await executeMlaiNativeGateway({grant:bad,body:{messages:[]}});expect(result.response.status).toBe(401);expect(fetch).not.toHaveBeenCalled();
});
it('does not retry or expose upstream credentials on rate limits',async()=>{
 const fetch=vi.fn(async()=>Response.json({error:'private upstream detail'},{status:429}));vi.stubGlobal('fetch',fetch);const result=await executeMlaiNativeGateway({grant,body:{messages:[]}});expect(result.response.status).toBe(429);expect(fetch).toHaveBeenCalledOnce();expect(await result.response.text()).not.toContain('private upstream');
});
