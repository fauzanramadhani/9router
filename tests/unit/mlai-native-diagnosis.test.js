import {it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({get:vi.fn(),update:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/localDb',()=>({getProviderConnectionById:m.get,updateProviderConnection:m.update}));
vi.mock('open-sse/utils/proxyFetch.js',()=>({proxyAwareFetch:m.fetch}));
vi.mock('@/lib/network/connectionProxy',()=>({resolveConnectionProxyConfig:async()=>({})}));
import {testSingleConnection} from '../../src/app/api/providers/[id]/test/testUtils.js';
it.each(['main','mlai-code','pixis-opus','future/vendor'])('diagnoses native metadata without rejecting configured model %s or claiming upstream acceptance',async defaultModel=>{
 m.get.mockResolvedValue({id:'device',defaultModel,provider:'mlai-code',authType:'oauth',accessToken:'mlaid_mock',expiresAt:new Date(Date.now()+3600000).toISOString(),providerSpecificData:{mlaiNative:true}});
 const result=await testSingleConnection('device');
 expect(result.valid).toBe(true);expect(result.message).toContain('metadata only');expect(m.fetch).not.toHaveBeenCalled();
});
