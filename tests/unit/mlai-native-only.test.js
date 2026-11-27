import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from '../../open-sse/utils/proxyFetch.js';
import { MlaiCodeExecutor } from '../../open-sse/executors/mlai-code.js';
beforeEach(() => vi.resetAllMocks());
it.each(['pixis','pixis-opus','pixis-sol','missing-model'])('rejects removed or unknown model %s instead of routing native', async model => {
 proxyAwareFetch.mockImplementation(async url => url.endsWith('/laptop') ? Response.json({gateway:'https://code.ml.ai/api/model/v1',token:'synthetic',expires:Date.now()+3600000}) : Response.json({choices:[]}));
 const result = await new MlaiCodeExecutor().execute({model,body:{messages:[]},credentials:{connectionId:'reject-'+model,accessToken:'mlaid_synthetic',providerSpecificData:{mlaiNative:true}}});
 expect(result.response.status).toBe(400);
 expect(await result.response.text()).toContain('main');
 expect(proxyAwareFetch).not.toHaveBeenCalled();
});
it('rejects API-key connections without any upstream request', async () => {
 const result = await new MlaiCodeExecutor().execute({ model:'main', body:{messages:[]}, credentials:{apiKey:'synthetic-legacy'} });
 expect(result.response.status).toBe(401);
 expect(await result.response.text()).toContain('device login');
 expect(proxyAwareFetch).not.toHaveBeenCalled();
});
