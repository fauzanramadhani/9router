import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { getMlaiNativeGrant } from '../../open-sse/services/mlaiNativeSession.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_DIR } from '../../src/lib/dataDir.js';
const owner = id => ({connectionId:id+'-'+process.pid+'-'+Date.now(),accessToken:'mlaid_'+id});
it('does not admit a duplicate run after module restart and persists no grant/device secret',async()=>{
 const credential=owner('restart-lifecycle');
 proxyAwareFetch.mockImplementation(async()=>Response.json(value()));
 await getMlaiNativeGrant(credential);
 vi.resetModules();
 const restarted=await import('../../open-sse/services/mlaiNativeSession.js');
 await expect(restarted.getMlaiNativeGrant(credential)).rejects.toMatchObject({code:'lifecycle_unverified'});
 expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
 expect(JSON.parse(proxyAwareFetch.mock.calls[1][1].body)).toEqual({action:'status'});
 expect(proxyAwareFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer secret-run');
 const directory=join(DATA_DIR,'mlai-native-sessions');
 const hash=s=>createHash('sha256').update(s).digest('hex');
 for(const file of [hash(credential.connectionId+':'+hash(credential.accessToken))+'.json']) {
  const stored=readFileSync(join(directory,file),'utf8');
  expect(stored).not.toMatch(/mlaid_|secret-run|run-test/);
 }
});
it('serializes concurrent admission for one owner but isolates another account',async()=>{
 const credential=owner('concurrent-lifecycle');
 proxyAwareFetch.mockImplementation(async()=>Response.json(value()));
 const grants=await Promise.all(Array.from({length:8},()=>getMlaiNativeGrant(credential)));
 expect(new Set(grants).size).toBe(1);expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
 await getMlaiNativeGrant(owner('separate-lifecycle'));
 expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});
it('uses a stable per-connection project across credential rotation',async()=>{
 const credential=owner('project-lifecycle');
 proxyAwareFetch.mockImplementation(async()=>Response.json(value()));
 await getMlaiNativeGrant(credential);
 await getMlaiNativeGrant({...credential,accessToken:'mlaid_rotated'});
 const projects=proxyAwareFetch.mock.calls.map(([,options])=>JSON.parse(options.body).project);
 expect(projects[0]).toBe(projects[1]);
});
const value = () => ({gateway:'https://code.ml.ai/api/model/v1', token:'secret-run', expires:Date.now()+3600000,runId:'run-test'});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Network forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('fails closed on unknown status after grant expiry',async()=>{
 const credential=owner('expiry-lifecycle');
 proxyAwareFetch.mockImplementation(async()=>Response.json(value()));
 await getMlaiNativeGrant(credential);
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+3600001);
 await expect(getMlaiNativeGrant(credential)).rejects.toMatchObject({code:'lifecycle_unverified'});
 expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});
