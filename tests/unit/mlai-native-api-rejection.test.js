import { beforeEach, it, expect, vi } from 'vitest';
const mocks=vi.hoisted(()=>({create:vi.fn(),get:vi.fn(),update:vi.fn(),fetch:vi.fn()}));
vi.mock('next/server',()=>({NextResponse:{json:(body,init)=>Response.json(body,init)}}));
vi.mock('@/models',()=>({getProviderConnections:vi.fn(),createProviderConnection:mocks.create,updateProviderConnection:mocks.update,deleteProviderConnection:vi.fn(),getProviderNodeById:vi.fn(),getProviderNodes:vi.fn(),getProxyPoolById:vi.fn(),getProviderConnectionById:mocks.get}));
vi.mock('@/lib/localDb',()=>({getProviderConnectionById:mocks.get,updateProviderConnection:mocks.update}));
vi.mock('@/lib/network/connectionProxy',()=>({resolveConnectionProxyConfig:async()=>({connectionProxyEnabled:false})}));
vi.mock('@/lib/network/proxyTest',()=>({testProxyUrl:vi.fn()}));
vi.mock('../../open-sse/utils/proxyFetch.js',()=>({proxyAwareFetch:mocks.fetch}));
import {PUT as update} from '../../src/app/api/providers/[id]/route.js';
import {POST as create} from '../../src/app/api/providers/route.js';
it('rejects API-key edits to saved ML AI connections',async()=>{
 mocks.get.mockResolvedValue({id:'legacy',provider:'mlai-code',authType:'apikey',apiKey:'synthetic-old'});
 const response=await update(request('mlai-code'),{params:Promise.resolve({id:'legacy'})});
 expect(response.status).toBe(400);expect(mocks.update).not.toHaveBeenCalled();
});
import {POST as validate} from '../../src/app/api/providers/validate/route.js';
import {testSingleConnection} from '../../src/app/api/providers/[id]/test/testUtils.js';
import entry from '../../open-sse/providers/registry/mlai-code.js';
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',mocks.fetch);});
const request=provider=>new Request('http://localhost/api/providers',{method:'POST',body:JSON.stringify({provider,apiKey:'synthetic-legacy',name:'synthetic',providerSpecificData:{mlaiNative:true}})});
it.each(['mlai','mlai-code'])('rejects API-key creation for %s even with a forged native flag',async provider=>{
 expect((await create(request(provider))).status).toBe(400);
 expect(mocks.create).not.toHaveBeenCalled();
});
it.each(['mlai','mlai-code'])('rejects API-key validation for %s locally',async provider=>{
 const response=await validate(request(provider));
 expect(response.status).toBe(400);
 expect((await response.json()).valid).toBe(false);
 expect(mocks.fetch).not.toHaveBeenCalled();
});
it('rejects saved legacy API-key diagnosis without probing upstream',async()=>{
 mocks.get.mockResolvedValue({id:'legacy',provider:'mlai-code',authType:'apikey',apiKey:'synthetic-legacy'});
 const result=await testSingleConnection('legacy');
 expect(result.valid).toBe(false);
 expect(result.error).toContain('device login');
 expect(mocks.fetch).not.toHaveBeenCalled();
});
it('advertises only native OAuth and main',()=>{
 expect(entry.category).toBe('oauth');expect(entry.authType).toBe('oauth');
 expect(entry.authModes).toEqual(['oauth']);expect(entry.models.map(m=>m.id)).toEqual(['main']);
 expect(entry.transport.baseUrl).toBe('https://code.ml.ai/api/model/v1');
 expect(entry.transport).not.toHaveProperty('jobDefaults');expect(entry).not.toHaveProperty('credentialPlaceholder');
});
