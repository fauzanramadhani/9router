import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { MlaiCodeExecutor } from "../../open-sse/executors/mlai-code.js";
const json = body => Response.json(body);
const tools = [{ type: "function", function: { name: "read_file", description: "Read text", parameters: { type: "object", properties: { path: { type: "string" } } } } }];
const base = { messages: [{ role: "user", content: "Read README" }], tools };
let launched;
function mockAgent(submission) {
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const data = JSON.parse(init.body);
    if (data.action === "start") { launched = data; return json({ ticket: "j" }); }
    if (data.ticket) return json({ workspace: { token: "w" } });
    return json({ status: { state: "completed", result: { submission: typeof submission === "function" ? submission(JSON.parse(launched.task)) : submission }, usage: { prompt: 4, completion: 3 } } });
  }));
}
const execute = (body = base, stream = false) => new MlaiCodeExecutor().execute({ body, model: "pixis", credentials: { apiKey: "mlai_sk_test" }, stream });
const protocol = task => JSON.parse(task.at(-1).content.split("\n").at(-1));
const envelope = (task, calls = [{ name: "read_file", arguments: { path: "README" } }]) => JSON.stringify({ nonce: protocol(task).nonce, content: null, tool_calls: calls });
afterEach(() => { vi.unstubAllGlobals(); launched = undefined; });
it.each([
  [() => '```json\n{"private":"DO_NOT_ECHO"}\n```', "json_syntax"],
  [() => JSON.stringify({ nonce: "DO_NOT_ECHO", content: null, tool_calls: [] }), "nonce_mismatch"],
  [task => JSON.stringify({ nonce: protocol(task).nonce, content: {}, tool_calls: [] }), "content_type"],
  [task => envelope(task, [{ name: "DO_NOT_ECHO", arguments: {} }]), "unknown_tool"],
  [task => envelope(task, [{ name: "read_file", arguments: "DO_NOT_ECHO" }]), "arguments_type"],
])("reports only a safe structural reason for malformed submissions (%s)", async (submission, reason) => {
  mockAgent(submission);
  const { response } = await execute();
  expect(response.status).toBe(502);
  const error = await response.json();
  expect(error.error.message).toBe(`ML AI Code: invalid client tool protocol submission (${reason})`);
  expect(JSON.stringify(error)).not.toContain("DO_NOT_ECHO");
});
it.each([
  task => JSON.stringify({ content: null, tool_calls: [{ name: "read_file", arguments: {} }] }),
  task => envelope(task, [{ name: "READ_FILE", arguments: {} }]),
  task => envelope(task, [{ name: "read_file", arguments: "{}" }]),
  task => envelope(task, [{ name: "read_file", arguments: [] }]),
  task => envelope(task).replace(protocol(task).nonce, "old-nonce"),
  () => '<tool>{"name":"read_file","arguments":{}}</tool>',
])("fails closed on unbound or invalid tool submissions", async submission => {
  mockAgent(submission);
  const { response } = await execute();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("old-nonce");
});
it.each([
  ["none", [{ name: "read_file", arguments: {} }]],
  ["required", []],
  [{ type: "function", function: { name: "read_file" } }, []],
])("enforces tool_choice %j on the returned submission", async (tool_choice, calls) => {
  mockAgent(task => envelope(task, calls));
  expect((await execute({ ...base, tool_choice })).response.status).toBe(502);
});
it.each(["auto", "required", { type: "function", function: { name: "read_file" } }])("accepts compliant tool_choice %j", async tool_choice => {
  mockAgent(task => envelope(task));
  const result = await execute({ ...base, tool_choice, parallel_tool_calls: false, response_format: { type: "text" } });
  expect(result.response.status).toBe(200);
  expect((await result.response.json()).choices[0].finish_reason).toBe("tool_calls");
});
it("binds each request to a fresh nonce even for the same tools array", async () => {
  const nonces = [];
  mockAgent(task => { nonces.push(protocol(task).nonce); return envelope(task); });
  await execute(); await execute();
  expect(nonces[0]).not.toBe(nonces[1]);
});
it("allows ordinary text when tool_choice none", async () => {
  mockAgent(task => JSON.stringify({ nonce: protocol(task).nonce, content: "hello", tool_calls: [] }));
  const result = await execute({ ...base, tool_choice: "none" });
  expect((await result.response.json()).choices[0]).toMatchObject({ finish_reason: "stop", message: { content: "hello" } });
});
it("does not emit parallel calls when disabled", async () => {
  mockAgent(task => envelope(task, [{ name: "read_file", arguments: {} }, { name: "read_file", arguments: {} }]));
  expect((await execute({ ...base, parallel_tool_calls: false })).response.status).toBe(502);
});
it("preserves real tool history and call IDs in a fresh task", async () => {
  const history = [{ role: "assistant", content: null, tool_calls: [{ id: "call_original", type: "function", function: { name: "read_file", arguments: '{"path":"README"}' } }] }, { role: "tool", tool_call_id: "call_original", content: "opaque return: 123" }];
  mockAgent(task => JSON.stringify({ nonce: protocol(task).nonce, content: "Got 123", tool_calls: [] }));
  const result = await execute({ ...base, messages: [...base.messages, ...history] });
  expect(result.response.status).toBe(200);
  expect(JSON.parse(launched.task).slice(1, 3)).toEqual(history);
  expect((await result.response.json()).choices[0].message.content).toBe("Got 123");
});
it("buffers indexed tool SSE deltas and include_usage with a terminal DONE", async () => {
  mockAgent(task => envelope(task));
  const result = await execute({ ...base, stream_options: { include_usage: true } }, true);
  const frames = (await result.response.text()).trim().split("\n\n").map(x => x.slice(6));
  expect(frames.pop()).toBe("[DONE]");
  const chunks = frames.map(JSON.parse);
  expect(chunks[1].choices[0].delta.tool_calls[0]).toMatchObject({ index: 0, function: { name: "read_file" } });
  expect(chunks.at(-2).choices[0].finish_reason).toBe("tool_calls");
  expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 7 } });
});
it.each([
 { tools: [{ type: "web_search" }] },
 { tools: [{ type: "function", function: { name: "read_file", strict: true } }] },
 { tool_choice: { type: "function", function: { name: "unknown" } } },
 { tools: {} }, { parallel_tool_calls: "false" },
])("rejects unsupported tool contract before network: %j", async extra => {
  mockAgent("unused");
  expect((await execute({ ...base, ...extra })).response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { messages: [{ role: "user", content: "hi", images: ["hidden"] }] },
  { tools: [{ type: "function", function: { name: "read_file", parameters: { type: "array" } } }] },
  { messages: [{ role: "assistant", content: "", tool_calls: [{ id: "x", type: "function", function: { name: "read_file", arguments: "[]" } }] }, { role: "tool", tool_call_id: "x", content: "r" }] },
  { messages: [{ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "read_file", arguments: "{}" } }] }] },
  { messages: [{ role: "tool", tool_call_id: "orphan", content: "r" }] },
])("rejects invalid or lossy history before launching: %j", async extra => {
  mockAgent("unused");
  expect((await execute({ ...base, ...extra })).response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["claude", "responses"])("accepts %s raw tools/history without discarding return data", async format => {
  const { validateMlaiCodeRequest } = await import("../../open-sse/services/mlaiCode.js");
  const raw = format === "claude" ? {
    tools: [{ name: "read_file", input_schema: { type: "object" } }],
    messages: [{ role: "assistant", content: [{ type: "tool_use", id: "call_orig", name: "read_file", input: { path: "a" } }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "call_orig", content: [{ type: "text", text: "opaque" }] }] }],
  } : { tools: [{ type: "function", name: "read_file", parameters: { type: "object" } }], input: [{ type: "function_call", call_id: "call_orig", name: "read_file", arguments: '{"path":"a"}' }, { type: "function_call_output", call_id: "call_orig", output: "opaque" }] };
  expect(validateMlaiCodeRequest(raw)).toBeNull();
  const { translateRequest } = await import("../../open-sse/translator/index.js");
  const translated = translateRequest(format === "claude" ? "claude" : "openai-responses", "openai", "pixis", raw, false, {}, "mlai-code");
  expect(translated.messages.find(m => m.role === "tool")).toEqual({ role: "tool", tool_call_id: "call_orig", content: "opaque" });
  expect(translated.tools[0].function.name).toBe("read_file");
  const namedRaw = { ...raw, tool_choice: format === "claude" ? { type: "tool", name: "read_file", disable_parallel_tool_use: true } : { type: "function", name: "read_file" }, parallel_tool_calls: false };
  const named = translateRequest(format === "claude" ? "claude" : "openai-responses", "openai", "pixis", namedRaw, false, {}, "mlai-code");
  expect(named.tool_choice).toEqual({ type: "function", function: { name: "read_file" } });
  expect(named.parallel_tool_calls).toBe(false);
  mockAgent(task => JSON.stringify({ nonce: protocol(task).nonce, content: "done", tool_calls: [] }));
  expect((await execute(raw)).response.status).toBe(200);
  expect(JSON.parse(launched.task)).toContainEqual({ role: "tool", tool_call_id: "call_orig", content: "opaque" });
  const bad = structuredClone(raw);
  if (format === "claude") bad.messages[1].content[0].content.push({ type: "image", source: {} });
  else bad.input[1].output = [{ type: "input_image", image_url: "x" }];
  expect(validateMlaiCodeRequest(bad)).toContain("unsupported");
});
it("preserves Claude tool-result error state as transcript data", async () => {
  mockAgent(task => JSON.stringify({ nonce: protocol(task).nonce, content: "failed", tool_calls: [] }));
  const result = await execute({ tools: [{ name: "read_file" }], messages: [{ role: "assistant", content: [{ type: "tool_use", id: "x", name: "read_file", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "permission denied", is_error: true }] }] });
  expect(result.response.status).toBe(200);
  expect(JSON.parse(launched.task)[1]).toMatchObject({ tool_call_id: "x", content: "permission denied", is_error: true });
});
it("emulates a client tool call from a nonce-bound final submission without registering upstream tools", async () => {
  mockAgent(task => envelope(task));
  const result = await execute();
  expect(result.response.status).toBe(200);
  const answer = await result.response.json();
  expect(answer.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ type: "function", function: { name: "read_file", arguments: '{"path":"README"}' } }] } });
  expect(answer.choices[0].message.tool_calls[0].id).toMatch(/^call_[\da-f-]+$/);
  expect(launched.tools).toEqual([]);
  expect(protocol(JSON.parse(launched.task)).tools).toEqual(tools);
  expect(JSON.parse(launched.task).at(-1).content).toContain("Do not execute client tools");
});

it("compacts large tool declarations so that 80+ tools stay under the 30,000 char task limit", async () => {
  const largeTools = [];
  for (let i = 0; i < 81; i++) {
    largeTools.push({
      type: "function",
      function: {
        name: `mcp_tool_${i}`,
        description: `Performs operation ${i} with very detailed description on the system workspace.`,
        parameters: {
          $schema: "http://json-schema.org/draft-07/schema#",
          title: `mcp_tool_${i}_args`,
          type: "object",
          properties: {
            path: { type: "string", description: "Target path" },
          },
          required: ["path"],
        },
      },
    });
  }

  mockAgent(task => JSON.stringify({ nonce: protocol(task).nonce, content: "Ready", tool_calls: [] }));
  const result = await execute({ ...base, tools: largeTools });
  expect(result.response.status).toBe(200);
  expect(launched.task.length).toBeLessThan(28500);
});
