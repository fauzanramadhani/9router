import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { getExecutor } from "../../open-sse/executors/index.js";

const key = "mlai_sk_unit_test";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("waits for workspace completion, never confuses job launch with the answer", async () => {
  const replies = [json({ ticket: "job" }, 202), json({ status: "completed", state: "launched", workspace: { token: "workspace" } }), json({ status: { state: "running" } }), json({ runId: "run-1", status: { state: "completed", result: { submission: "Final answer" }, usage: { prompt: 10, cached: 2, completion: 4, modelId: "pixis-opus" } } })];
  const fetcher = vi.fn(async () => replies.shift());
  vi.stubGlobal("fetch", fetcher);
  const executor = getExecutor("mlai-code");
  const result = await executor.execute({ model: "pixis-opus", body: { messages: [{ role: "system", content: "Rules" }, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: [{ type: "text", text: "Continue" }] }] }, credentials: { apiKey: key }, stream: false });
  expect(fetcher).toHaveBeenCalledTimes(4);
  const calls = fetcher.mock.calls.map(([url, init]) => ({ url, init, body: JSON.parse(init.body) }));
  expect(calls[0].url).toBe("https://code.ml.ai/api/jobs");
  expect(calls[0].init.headers.Authorization).toBe(`Bearer ${key}`);
  expect(calls[0].body).toMatchObject({ action: "start", model: "pixis-opus", steps: 4, tools: [], connected: [], imageLimit: 0 });
  expect(calls[0].body.requestId).toMatch(/^[\da-f-]{36}$/);
  expect(JSON.parse(calls[0].body.task)).toEqual([{ role: "system", content: "Rules" }, { role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }, { role: "user", content: "Continue" }]);
  expect(calls[1].body).toEqual({ action: "status", ticket: "job" });
  expect(calls[2].url).toBe("https://code.ml.ai/api/workspace");
  expect(calls[2].body).toEqual({ action: "status", token: "workspace" });
  const answer = await result.response.json();
  expect(answer.choices[0].message).toEqual({ role: "assistant", content: "Final answer" });
  expect(answer.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, prompt_tokens_details: { cached_tokens: 2 } });
  expect(JSON.stringify({ headers: result.headers, transformedBody: result.transformedBody })).not.toContain(key);
});

it("buffers a valid OpenAI SSE final answer and gives every request a fresh id", async () => {
  const ids = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const data = JSON.parse(init.body);
    if (data.action === "start") { ids.push(data.requestId); return json({ ticket: "job" }, 202); }
    if (data.ticket) return json({ status: "completed", workspace: { token: "fresh" } });
    return json({ status: { state: "completed", result: { submission: "Done" } } });
  }));
  for (let i = 0; i < 2; i++) {
    const { response } = await getExecutor("mlai").execute({ model: "pixis-opus", body: { messages: [{ role: "user", content: "Hi" }] }, credentials: { apiKey: key }, stream: true });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const frames = (await response.text()).trim().split("\n\n").map(f => f.slice(6));
    expect(frames.pop()).toBe("[DONE]");
    const chunks = frames.map(JSON.parse);
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    expect(chunks[1].choices[0].delta.content).toBe("Done");
    expect(chunks.at(-1).choices[0].finish_reason).toBe("stop");
  }
  expect(ids[0]).not.toBe(ids[1]);
});

it.each([
  { tools: [{ type: "function", function: { name: "run" } }] },
  { functions: [{ name: "run" }] },
  { messages: [{ role: "tool", content: "result" }] },
  { messages: [{ role: "assistant", content: "", tool_calls: [{ id: "call" }] }] },
  ...["image_url", "input_audio", "file", "tool_use"].map(type => ({ messages: [{ role: "user", content: [{ type, text: "must not be silently dropped" }] }] })),
  { messages: [] },
  { n: 2 },
  { response_format: { type: "json_schema" } },
])("rejects unsupported request data before launching an agent: %j", async extra => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const result = await getExecutor("mlai-code").execute({ model: "pixis-opus", body: { messages: [{ role: "user", content: "hi" }], ...extra }, credentials: { apiKey: key }, stream: false });
  expect(result.response.status).toBe(400);
  expect((await result.response.json()).error.message).toContain("ML AI Code");
  expect(fetcher).not.toHaveBeenCalled();
});

describe("bounded ML AI agent lifecycle", () => {
  const args = { model: "pixis-opus", body: { messages: [{ role: "user", content: "hi" }] }, credentials: { apiKey: key }, stream: false };
  it.each([401, 403, 429, 500])("preserves upstream HTTP %i without leaking upstream secrets", async code => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: `${key} workspace-secret` }, code)));
    const result = await getExecutor("mlai-code").execute(args);
    expect(result.response.status).toBe(code);
    expect(await result.response.text()).not.toContain(key);
  });
  it.each([
    [{}, 502],
    [{ ticket: "job" }, { status: "failed", error: key }, 502],
    [{ ticket: "job" }, { status: "completed" }, 502],
    [{ ticket: "job" }, { workspace: { token: "w" } }, { status: { state: "failed" } }, 502],
    [{ ticket: "job" }, { workspace: { token: "w" } }, { status: { state: "completed", result: {} } }, 502],
  ])("rejects malformed or failed jobs: %j", async (...sequence) => {
    const status = sequence.pop();
    vi.stubGlobal("fetch", vi.fn(async () => json(sequence.shift())));
    const result = await getExecutor("mlai-code").execute(args);
    expect(result.response.status).toBe(status);
  });
  it("bounds the number of polls", async () => {
    const { MlaiCodeExecutor } = await import("../../open-sse/executors/mlai-code.js");
    const executor = new MlaiCodeExecutor({ ...PROVIDERS["mlai-code"], maxPolls: 2, pollIntervalMs: 0 });
    const fetcher = vi.fn(async () => json({ ticket: "job", status: "pending" }));
    vi.stubGlobal("fetch", fetcher);
    const result = await executor.execute(args);
    expect(result.response.status).toBe(504);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("times out a hanging fetch and returns a gateway timeout", async () => {
    const { MlaiCodeExecutor } = await import("../../open-sse/executors/mlai-code.js");
    const executor = new MlaiCodeExecutor({ ...PROVIDERS["mlai-code"], timeoutMs: 10 });
    vi.stubGlobal("fetch", vi.fn((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }))));
    const result = await executor.execute(args);
    expect(result.response.status).toBe(504);
  });
  it("does not launch if caller already aborted", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(getExecutor("mlai-code").execute({ ...args, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("stops polling immediately when caller cancels a pending poll delay", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length === 2) setTimeout(() => controller.abort(), 10);
      return json({ ticket: "job", status: "pending" });
    }); vi.stubGlobal("fetch", fetcher);
    await expect(getExecutor("mlai-code").execute({ ...args, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("requires a key and rejects oversized tasks before network activity", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect((await getExecutor("mlai-code").execute({ ...args, credentials: {} })).response.status).toBe(401);
    expect((await getExecutor("mlai-code").execute({ ...args, credentials: undefined })).response.status).toBe(401);
    expect((await getExecutor("mlai-code").execute({ ...args, body: { messages: [{ role: "user", content: "x".repeat(200001) }] } })).response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it.each([
  { messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", data: "file" } }] }] },
  { input: [{ role: "user", content: [{ type: "input_file", file_id: "file" }] }] },
  { input: [{ type: "function_call", name: "run" }] },
  { modalities: ["audio"] },
  { tool_choice: "required" },
])("preflights raw client data before lossy intermediary conversions: %j", async body => {
  const { validateMlaiCodeRequest } = await import("../../open-sse/services/mlaiCode.js");
  expect(validateMlaiCodeRequest(body)).toContain("unsupported");
});

it.each(["claude", "openai-responses"])("reuses the OpenAI bridge for %s text conversations", async format => {
  const { translateRequest } = await import("../../open-sse/translator/index.js");
  const original = format === "claude"
    ? { system: "Rules", messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] }
    : { instructions: "Rules", input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }] };
  const body = translateRequest(format, "openai", "pixis-opus", original, false, {}, "mlai-code");
  let transcript;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const data = JSON.parse(init.body);
    if (data.action === "start") { transcript = JSON.parse(data.task); return json({ ticket: "job" }, 202); }
    if (data.ticket) return json({ workspace: { token: "workspace" } });
    return json({ status: { state: "completed", result: { submission: "Answer" } } });
  }));
  const result = await getExecutor("mlai-code").execute({ model: "pixis-opus", body, stream: false, credentials: { apiKey: key } });
  expect(result.response.status).toBe(200);
  expect(transcript.find(m => m.role === "system").content).toContain("Rules");
  expect(transcript.find(m => m.role === "user").content).toBe("Hi");
});

describe("ML AI Code registration", () => {
  it("exposes the key-only agent with its bundled models and safe validation endpoint", () => {
    const entry = REGISTRY.find(e => e.id === "mlai-code");
    expect(entry).toBeDefined();
    expect(entry.alias).toBe("mlai");
    expect(entry.category).toBe("apikey");
    expect(entry.authHint).toContain("mlai_sk");
    expect(PROVIDERS[entry.id].format).toBe("openai");
    expect(PROVIDERS[entry.id].validateUrl).toBe("https://code.ml.ai/api/routines");
    expect(PROVIDER_MODELS.mlai.map(m => m.id)).toEqual(["pixis-opus", "pixis", "pixis-sol"]);
  });
});
