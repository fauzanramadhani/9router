import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn(), getProviderConnectionById: mocks.get }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get, updateProviderConnection: mocks.update }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({ connectionProxyEnabled: false }) }));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { POST } from "../../src/app/api/providers/validate/route.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseModel } from "../../open-sse/services/model.js";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("surfaces the agent in the existing API-key provider UI and resolves the alias", () => {
  expect(AI_PROVIDERS["mlai-code"].name).toContain("ML AI Code");
  expect(AI_PROVIDERS["mlai-code"].credentialLabel).toContain("ML AI Code");
  expect(AI_PROVIDERS["mlai-code"].credentialPlaceholder).toBe("mlai_sk…");
  expect(parseModel("mlai/pixis-opus")).toMatchObject({ provider: "mlai-code", model: "pixis-opus" });
});
it.each([200, 401, 403, 429, 500])("validates keys without launching a job, status %i", async status => {
  const fetcher = vi.fn(async () => Response.json(status === 200 ? { configured: true, routines: [] } : {}, { status }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(new Request("http://localhost/api/providers/validate", { method: "POST", body: JSON.stringify({ provider: "mlai", apiKey: "mlai_sk_test" }) }));
  expect((await response.json()).valid).toBe(status === 200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://code.ml.ai/api/routines");
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer mlai_sk_test");
});
it("tests saved ML AI Code keys with the read-only routines probe", async () => {
  mocks.get.mockResolvedValue({ id: "mlai-test", provider: "mlai-code", authType: "apikey", apiKey: "mlai_sk_test" });
  const fetcher = vi.fn(async () => Response.json({ configured: true, routines: [] }));
  vi.stubGlobal("fetch", fetcher);
  const result = await testSingleConnection("mlai-test");
  expect(result.valid).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe("https://code.ml.ai/api/routines");
});
