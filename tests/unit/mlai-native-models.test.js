import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js',()=>({proxyAwareFetch:vi.fn()}));
vi.mock('@/lib/usageDb.js',()=>({trackPendingRequest:vi.fn(),appendRequestLog:async()=>{},saveRequestDetail:async()=>{}}));
vi.mock('../../open-sse/utils/requestLogger.js',()=>({createRequestLogger:async()=>new Proxy({},{get:(_target,key)=>key==='then'?undefined:()=>{}})}));
import registry from '../../open-sse/providers/registry/mlai-code.js';
import {getModelInfoCore} from '../../open-sse/services/model.js';
import {handleChatCore} from '../../open-sse/handlers/chatCore.js';
import {proxyAwareFetch} from '../../open-sse/utils/proxyFetch.js';
beforeEach(()=>vi.resetAllMocks());
it('advertises only the native default and the observed upstream catalogue ID',()=>{
 expect(registry.models.map(m=>m.id)).toEqual(['main','mlai-code']);
 expect(registry.authModes).toEqual(['oauth']);
 expect(registry.authHint).not.toContain('Only mlai/main');
});
it.each(['mlai/future/vendor-model','mlai-code/future/vendor-model','my-native-alias'])('routes %s through core, translator and executor without rewriting model identity',async requested=>{
 for(const stream of [false,true]) {
 proxyAwareFetch.mockReset();
 const modelInfo=await getModelInfoCore(requested,{'my-native-alias':'mlai/future/vendor-model'});
 expect(modelInfo).toEqual({provider:'mlai-code',model:'future/vendor-model'});
 const wire=stream?'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n':JSON.stringify({id:'mock',object:'chat.completion',model:'future/vendor-model',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}]});
 proxyAwareFetch.mockImplementation(async url=>url.endsWith('/laptop')?Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'synthetic',model:'grant-metadata',expires:Date.now()+3600000}):new Response(wire,{headers:{'content-type':stream?'text/event-stream':'application/json'}}));
 const body={model:requested,stream,messages:[{role:'system',content:'complete'},{role:'user',content:'hi'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object',additionalProperties:false}}}],tool_choice:'auto'};
 const connectionId='wire-'+requested+'-'+stream;
 const result=await handleChatCore({body:structuredClone(body),modelInfo,credentials:{connectionId,accessToken:'mlaid_synthetic',providerSpecificData:{mlaiNative:true}},connectionId,sourceFormatOverride:'openai'});
 expect(result.response.status).toBe(200);await result.response.text();
 const calls=proxyAwareFetch.mock.calls.filter(([url])=>url.endsWith('/chat/completions'));
 expect(calls).toHaveLength(1);
 expect(calls[0][0]).toBe('https://code.ml.ai/api/model/v1/chat/completions');
 expect(JSON.parse(calls[0][1].body)).toEqual({...body,model:'future/vendor-model'});
 }
});
it.each([400,404,422,429])('preserves upstream model rejection status %s without fallback or replay',async status=>{
 proxyAwareFetch.mockImplementation(async url=>url.endsWith('/laptop')?Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'synthetic',expires:Date.now()+3600000}):Response.json({error:{message:'untrusted detail'}},{status,headers:{'Retry-After':'27'}}));
 const connectionId='model-error-'+status;
 const result=await handleChatCore({body:{model:'mlai/future-model',stream:false,messages:[{role:'user',content:'hi'}]},modelInfo:{provider:'mlai-code',model:'future-model'},credentials:{connectionId,accessToken:'mlaid_synthetic',providerSpecificData:{mlaiNative:true}},connectionId,sourceFormatOverride:'openai'});
 expect(result.response.status).toBe(status);
 expect(result.response.headers.get('Retry-After')).toBe('27');
 expect(await result.response.text()).not.toContain('untrusted detail');
 const calls=proxyAwareFetch.mock.calls.filter(([url])=>url.endsWith('/chat/completions'));
 expect(calls).toHaveLength(1);expect(JSON.parse(calls[0][1].body).model).toBe('future-model');
});
