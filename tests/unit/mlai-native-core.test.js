import {it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../../open-sse/executors/index.js',()=>({getExecutor:()=>({execute:m.execute})}));
vi.mock('@/lib/usageDb.js',()=>({trackPendingRequest:vi.fn(),appendRequestLog:async()=>{},saveRequestDetail:async()=>{}}));
vi.mock('../../open-sse/utils/requestLogger.js',()=>({createRequestLogger:async()=>new Proxy({},{get:(_target,key)=>key==='then'?undefined:()=>{}})}));
import {handleChatCore} from '../../open-sse/handlers/chatCore.js';
it.each(['pixis','pixis-opus','pixis-sol'])('core rejects removed model %s before executor dispatch',async model=>{
 m.execute.mockClear();
 const result=await handleChatCore({body:{messages:[{role:'user',content:'hi'}]},modelInfo:{provider:'mlai-code',model},credentials:{providerSpecificData:{mlaiNative:true}}});
 expect(result.response.status).toBe(400);expect(m.execute).not.toHaveBeenCalled();
});
it('core rejects legacy credentials before any executor dispatch',async()=>{
 m.execute.mockClear();
 const result=await handleChatCore({body:{messages:[{role:'user',content:'hi'}]},modelInfo:{provider:'mlai-code',model:'main'},credentials:{apiKey:'synthetic'}});
 expect(result.response.status).toBe(401);expect(m.execute).not.toHaveBeenCalled();
});
it('main router forwards all native context/tools even when token savers are configured',async()=>{
 const body={model:'mlai/main',stream:false,messages:[{role:'system',content:'S'.repeat(220000)},{role:'user',content:'hi'}],tools:[{type:'function',function:{name:'read',parameters:{type:'object',additionalProperties:false}}},{type:'function',function:{name:'read',parameters:{type:'object'}}}],tool_choice:'required'};
 m.execute.mockImplementation(async({body})=>({response:Response.json({id:'test',object:'chat.completion',model:'main',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}]}),url:'https://code.ml.ai/api/model/v1/chat/completions',headers:{},transformedBody:body}));
 const result=await handleChatCore({body:structuredClone(body),modelInfo:{provider:'mlai-code',model:'main'},credentials:{connectionId:'native-core',providerSpecificData:{mlaiNative:true}},connectionId:'native-core',rtkEnabled:true,headroomEnabled:true,pxpipeEnabled:true,sourceFormatOverride:'openai'});
 expect(result).toBeTruthy();
 expect(m.execute).toHaveBeenCalledTimes(1);
 expect(m.execute.mock.calls[0][0].body).toEqual({...body,model:'main'});
});
