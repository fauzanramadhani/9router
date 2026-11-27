import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({start:vi.fn(),save:vi.fn()}));
vi.mock('../../src/lib/oauth/services/mlai-native.js',()=>({startMlaiLogin:mocks.start}));
vi.mock('@/models',()=>({createProviderConnection:mocks.save}));
import {POST} from '../../src/app/api/oauth/mlai-code/native/route.js';
it('keeps login private server-side and exposes only sanitized status',async()=>{
 mocks.start.mockResolvedValue({authorizeUrl:'https://code.ml.ai/clients/auth?state=synthetic',status:()=>({status:'done',connection:{id:'mock-id'}}),cancel:vi.fn()});
 const response=await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',body:JSON.stringify({action:'start'})}));
 const data=await response.json();
 expect(response.status).toBe(200);expect(data.session).toBeTruthy();expect(data.authorizeUrl).toContain('/clients/auth');
 const poll=await POST(new Request('http://localhost/api/oauth/mlai-code/native',{method:'POST',body:JSON.stringify({action:'status',session:data.session})}));
 expect(await poll.json()).toEqual({status:'done',connection:{id:'mock-id'}});
 expect(mocks.start.mock.calls[0][0].saveConnection).toBe(mocks.save);
});
