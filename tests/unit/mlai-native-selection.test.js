import {describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/localDb',()=>({getProviderConnections:vi.fn(),validateApiKey:vi.fn(),updateProviderConnection:vi.fn(),getSettings:vi.fn(),getProxyPools:vi.fn()}));
vi.mock('@/lib/network/connectionProxy',()=>({resolveConnectionProxyConfig:vi.fn(async()=>({})),pickProxyPoolId:vi.fn()}));
import {getProviderConnections,getSettings,updateProviderConnection} from '@/lib/localDb';
import {getProviderCredentials} from '../../src/sse/services/auth.js';
describe('ML AI native selection',()=>{
 it.each([null,'pixis-opus','main'])('never selects a legacy account for model %s',async model=>{
 getProviderConnections.mockResolvedValue([{id:'legacy-only',provider:'mlai-code',authType:'apikey',apiKey:'synthetic'}]);
 getSettings.mockResolvedValue({});updateProviderConnection.mockClear();
 expect(await getProviderCredentials('mlai-code',null,model)).toBeNull();
 expect(updateProviderConnection).not.toHaveBeenCalled();
 });
 it('rotates two native connections using the configured round-robin policy',async()=>{
 const connections=['native-a','native-b'].map((id,i)=>({id,provider:'mlai-code',authType:'oauth',accessToken:'mlaid_'+id,priority:i+1,providerSpecificData:{mlaiNative:true}}));
 getProviderConnections.mockResolvedValue(connections);
 getSettings.mockResolvedValue({providerStrategies:{'mlai-code':{fallbackStrategy:'round-robin',stickyRoundRobinLimit:1}}});
 updateProviderConnection.mockImplementation(async(id,changes)=>Object.assign(connections.find(c=>c.id===id),changes));
 const first=await getProviderCredentials('mlai-code',null,'main');
 const second=await getProviderCredentials('mlai-code',null,'main');
 expect([first.connectionId,second.connectionId]).toEqual(['native-a','native-b']);
 });
 it('does not route native main requests into a legacy API-key account',async()=>{
 getProviderConnections.mockResolvedValue([{id:'legacy',provider:'mlai-code',apiKey:'synthetic',priority:1},{id:'native',provider:'mlai-code',authType:'oauth',accessToken:'mlaid_synthetic',priority:2,providerSpecificData:{mlaiNative:true}}]);
 getSettings.mockResolvedValue({});updateProviderConnection.mockResolvedValue({});
 const chosen=await getProviderCredentials('mlai-code',null,'main');
 expect(chosen.connectionId).toBe('native');
 });
});
