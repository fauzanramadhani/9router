import {afterEach,beforeEach,it,expect,vi} from 'vitest';
beforeEach(()=>{vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN','');vi.stubEnv('BASE_URL','');});
afterEach(()=>vi.unstubAllEnvs());
const mocks=vi.hoisted(()=>({start:vi.fn(),save:vi.fn()}));
vi.mock('../../src/lib/oauth/services/mlai-native.js',()=>({startMlaiLogin:mocks.start}));
vi.mock('@/models',()=>({createProviderConnection:mocks.save}));
import {POST} from '../../src/app/api/oauth/mlai-code/native/route.js';
const call=(body,headers={})=>POST(new Request('https://pooling.example.test/api/oauth/mlai-code/native',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://pooling.example.test',...headers},body:JSON.stringify(body)}));
it('submits callback only to its private login session and leaves terminal status readable by polling',async()=>{
 const submitCallback=vi.fn(async()=>({status:'done',connection:{id:'remote'}}));
 const cancel=vi.fn();mocks.start.mockResolvedValue({authorizeUrl:'https://code.ml.ai/clients/auth',status:()=>({status:'done',connection:{id:'remote'}}),cancel,submitCallback});
 const {session}=await (await call({action:'start'})).json();
 const invalid=await call({action:'callback',session:'wrong',callbackUrl:'synthetic'});expect(invalid.status).toBe(404);expect(submitCallback).not.toHaveBeenCalled();
 const result=await call({action:'callback',session,callbackUrl:'synthetic'});expect(result.status).toBe(200);expect(await result.json()).toEqual({status:'done',connection:{id:'remote'}});expect(submitCallback).toHaveBeenCalledExactlyOnceWith('synthetic');
 expect(await (await call({action:'status',session})).json()).toEqual({status:'done',connection:{id:'remote'}});
 expect(await (await call({action:'status',session})).json()).toEqual({status:'done',connection:{id:'remote'}});
 await call({action:'cancel',session});
});
it.each(['https://evil.test','null'])('blocks foreign origin %s before creating or using a login',async(origin)=>{
 const before=mocks.start.mock.calls.length;const result=await call({action:'start'},{Origin:origin});expect(result.status).toBe(403);expect(mocks.start.mock.calls.length).toBe(before);
});
it('blocks cross-site requests even when Origin is absent',async()=>{const response=await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'},body:JSON.stringify({action:'start'})}));expect(response.status).toBe(403);});
it('rejects non-JSON browser posts and invalid body shapes',async()=>{expect((await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'text/plain'},body:'{}'}))).status).toBe(415);expect((await call(null)).status).toBe(400);});
it('sanitizes callback exceptions and keeps the session available',async()=>{
 const submitCallback=vi.fn(async()=>{throw new Error('secret-code');});mocks.start.mockResolvedValue({authorizeUrl:'https://code.ml.ai/clients/auth',status:()=>({status:'pending'}),cancel:vi.fn(),submitCallback});
 const {session}=await(await call({action:'start'})).json();const result=await call({action:'callback',session,callbackUrl:'invalid'});expect(result.status).toBe(400);expect(await result.text()).not.toContain('secret-code');expect(await(await call({action:'status',session})).json()).toEqual({status:'pending'});await call({action:'cancel',session});
});
it('keeps login private server-side and exposes only sanitized status',async()=>{
 mocks.start.mockResolvedValue({authorizeUrl:'https://code.ml.ai/clients/auth?state=synthetic',status:()=>({status:'done',connection:{id:'mock-id'}}),cancel:vi.fn()});
 const response=await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})}));
 const data=await response.json();
 expect(response.status).toBe(200);expect(data.session).toBeTruthy();expect(data.authorizeUrl).toContain('/clients/auth');
 const poll=await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'status',session:data.session})}));
 expect(await poll.json()).toEqual({status:'done',connection:{id:'mock-id'}});
 expect(mocks.start.mock.calls[0][0].saveConnection).toBe(mocks.save);
});
