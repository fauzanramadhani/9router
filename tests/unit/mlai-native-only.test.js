import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { MlaiCodeExecutor } from '../../open-sse/executors/mlai-code.js';
beforeEach(() => vi.resetAllMocks());
it.each(['pixis','pixis-opus','pixis-sol','missing-model','mlai-code','vendor/new-model'])('forwards selected model %s to the fixed native endpoint', async model => {
 proxyAwareFetch.mockImplementation(async url => url.endsWith('/laptop') ? Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'synthetic',expires:Date.now()+3600000}) : Response.json({choices:[]}));
 const result = await new MlaiCodeExecutor().execute({model,body:{model:'mlai/'+model,messages:[]},credentials:{connectionId:'reject-'+model,accessToken:'mlaid_synthetic',providerSpecificData:{mlaiNative:true}}});
 expect(result.response.status).toBe(200);
 const inference=proxyAwareFetch.mock.calls.filter(([url])=>url.endsWith('/chat/completions'));
 expect(inference).toHaveLength(1);
 expect(inference[0][0]).toBe('https://code.ml.ai/api/model/v1/chat/completions');
 expect(JSON.parse(inference[0][1].body)).toEqual({model,messages:[]});
});
it('rejects API-key connections without any upstream request', async () => {
 const result = await new MlaiCodeExecutor().execute({ model:'main', body:{messages:[]}, credentials:{apiKey:'synthetic-legacy'} });
 expect(result.response.status).toBe(401);
 expect(await result.response.text()).toContain('device login');
 expect(proxyAwareFetch).not.toHaveBeenCalled();
});
