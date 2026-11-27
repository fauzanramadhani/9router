import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({start:vi.fn(),save:vi.fn()}));
vi.mock('../../src/lib/oauth/services/mlai-native.js',()=>({startMlaiLogin:mocks.start}));
vi.mock('@/models',()=>({createProviderConnection:mocks.save}));
import {POST} from '../../src/app/api/oauth/mlai-code/native/route.js';
const publicOrigin='https://pooling.zanslab.id';
const internalUrl='http://router:20128/api/oauth/mlai-code/native';
const call=(origin=publicOrigin,headers={},url=internalUrl)=>POST(new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...(origin===undefined?{}:{Origin:origin}),...headers},body:JSON.stringify({action:'status',session:'missing'})}));
beforeEach(()=>{vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN','');vi.stubEnv('BASE_URL','');vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Unexpected network');}));mocks.start.mockClear();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('accepts configured HTTPS public origin behind internal HTTP without weakening session checks',async()=>{
 vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN',publicOrigin);
 vi.stubEnv('BASE_URL','https://stale.example.test');
 expect((await call()).status).toBe(404);
 expect(mocks.start).not.toHaveBeenCalled();
 expect(fetch).not.toHaveBeenCalled();
});
it('starts and cancels a login through the configured public origin',async()=>{
 vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN',publicOrigin);
 const cancel=vi.fn();
 mocks.start.mockResolvedValue({authorizeUrl:'https://code.ml.ai/clients/auth',status:()=>({status:'pending'}),cancel});
 const post=body=>POST(new Request(internalUrl,{method:'POST',headers:{'Content-Type':'application/json',Origin:publicOrigin},body:JSON.stringify(body)}));
 const response=await post({action:'start'});
 expect(response.status).toBe(200);
 const {session}=await response.json();
 expect(session).toBeTruthy();
 expect(mocks.start).toHaveBeenCalledExactlyOnceWith({saveConnection:mocks.save});
 expect((await post({action:'cancel',session})).status).toBe(200);
 expect(cancel).toHaveBeenCalledOnce();
 expect(fetch).not.toHaveBeenCalled();
});
it('falls back to server BASE_URL when the dedicated setting is absent',async()=>{
 vi.stubEnv('BASE_URL',publicOrigin);
 expect((await call()).status).toBe(404);
});
it('uses the local request origin when neither server setting exists',async()=>{
 expect((await call('http://localhost:20128',{},'http://localhost:20128/api/oauth/mlai-code/native')).status).toBe(404);
});
it.each(['https://evil.test','null','http://router:20128','https://stale.example.test'])('rejects foreign origin %s even with spoofed proxy headers',async origin=>{
 vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN',publicOrigin);
 vi.stubEnv('BASE_URL','https://stale.example.test');
 const response=await call(origin,{'X-Forwarded-Host':new URL(origin==='null'?'https://evil.test':origin).host,'X-Forwarded-Proto':'https',Forwarded:'host=evil.test;proto=https',Host:'evil.test'});
 expect(response.status).toBe(403);
 expect(mocks.start).not.toHaveBeenCalled();
 expect(fetch).not.toHaveBeenCalled();
});
it('does not derive an allowed origin from forwarding headers without configuration',async()=>{
 expect((await call('https://evil.test',{'X-Forwarded-Host':'evil.test','X-Forwarded-Proto':'https',Forwarded:'host=evil.test;proto=https'})).status).toBe(403);
});
it('rejects cross-site metadata even with the configured valid Origin',async()=>{
 vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN',publicOrigin);
 expect((await call(publicOrigin,{'Sec-Fetch-Site':'cross-site'})).status).toBe(403);
});
it.each(['invalid','null','ftp://pooling.zanslab.id','https://user:password@pooling.zanslab.id','https://pooling.zanslab.id/path','https://pooling.zanslab.id?query=x','https://pooling.zanslab.id#fragment','   '])('fails closed for invalid dedicated origin %s',async configured=>{
 vi.stubEnv('MLAI_NATIVE_PUBLIC_ORIGIN',configured);
 vi.stubEnv('BASE_URL',publicOrigin);
 expect((await call()).status).toBe(403);
 expect(mocks.start).not.toHaveBeenCalled();
 expect(fetch).not.toHaveBeenCalled();
});
it('fails closed for an invalid BASE_URL instead of accepting request.url',async()=>{
 vi.stubEnv('BASE_URL','not-a-url');
 expect((await call('http://router:20128')).status).toBe(403);
});
