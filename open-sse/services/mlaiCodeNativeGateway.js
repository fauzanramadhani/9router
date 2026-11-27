import {proxyAwareFetch} from '../utils/proxyFetch.js';
import { classifyMlaiNativeError, RUN_CLOSED_MESSAGE } from './mlaiNativeErrors.js';
// Trusted operator grant obtained through the official device/laptop lifecycle.
// Never accept endpoint/token grants from the client request body.
export async function executeMlaiNativeGateway({grant,body,stream,signal,proxyOptions=null}) {
 const failure=(status,message,code='upstream_error')=>({response:Response.json({error:{message,type:'mlai_native_error',code}},{status}),headers:{},transformedBody:null});
 if(grant?.terminal) return failure(409,RUN_CLOSED_MESSAGE,'run_closed');
 if(!grant || grant.endpoint!=='https://code.ml.ai/api/model/v1' || typeof grant.token!=='string' || !grant.token || !Number.isFinite(grant.expires) || grant.expires<=Date.now())return failure(401,'ML AI native run grant missing or expired');
 const transformedBody={...body,model:body?.model ?? 'main',...(stream===undefined?{}:{stream})};
 try {
  const response=await proxyAwareFetch(grant.endpoint+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+grant.token,'Content-Type':'application/json'},body:JSON.stringify(transformedBody),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(240000)},proxyOptions);
  if(!response.ok){const diagnostic=await classifyMlaiNativeError(response);if(diagnostic.code==='run_closed'){grant.terminal=true;grant.renewable=diagnostic.renewable;grant.persist?.();}if([401,402,403,429].includes(response.status)){grant.blocked={status:response.status,message:diagnostic.message,code:diagnostic.code,retryAfter:response.headers.get('retry-after')};grant.persist?.();}const result=failure(response.status,diagnostic.message,diagnostic.code);result.renewableRunFinished=diagnostic.renewable===true;const retryAfter=response.headers.get('retry-after');if(retryAfter)result.response.headers.set('Retry-After',retryAfter);return result;}
  return {response,url:grant.endpoint+'/chat/completions',headers:{'Content-Type':'application/json'},transformedBody};
 }catch(error){if(signal?.aborted)throw signal.reason;return failure(error.name==='TimeoutError'?504:502,'ML AI native gateway request failed');}
}
