import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { ROLE, OPENAI_FINISH } from "../translator/schema/index.js";
import { validateMlaiCodeRequest } from "../services/mlaiCode.js";
import { prepareMlaiTools, normalizeMlaiCodeRequest } from "../services/mlaiCodeTools.js";

// Agent adapter, not an inference endpoint. Never reuse remote workspaces across requests.
export class MlaiCodeExecutor extends BaseExecutor {
  constructor(config = PROVIDERS["mlai-code"]) {
    super("mlai-code", config);
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const failure = (status, message) => ({ response: Response.json({ error: { message: `ML AI Code: ${message}`, type: "mlai_code_error" } }, { status }), url: this.config.baseUrl, headers: {}, transformedBody: null });
    const unsupported = validateMlaiCodeRequest(body || {});
    if (unsupported) return failure(400, unsupported);
    body = normalizeMlaiCodeRequest(body);
    if (!credentials?.apiKey) return failure(401, "an mlai_sk API key is required");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` };
    const toolMode = prepareMlaiTools(body, body.messages);
    const task = toolMode.task;
    if (task.length > this.config.maxTaskChars) return failure(400, "text transcript exceeds the request limit");
    signal?.throwIfAborted();
    const transformedBody = { ...this.config.jobDefaults, requestId: randomUUID(), task, model };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("Agent deadline exceeded", "TimeoutError")), this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    const pause = () => new Promise((resolve, reject) => {
      combined.throwIfAborted();
      const abort = () => { clearTimeout(wait); reject(combined.reason); };
      const wait = setTimeout(() => { combined.removeEventListener("abort", abort); resolve(); }, this.config.pollIntervalMs);
      combined.addEventListener("abort", abort, { once: true });
    });
    const post = async (url, data) => {
      combined.throwIfAborted();
      const response = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(data), signal: combined }, proxyOptions);
      if (!response.ok) {
        await response.body?.cancel();
        fail(response.status, `upstream HTTP ${response.status}`);
      }
      const value = await response.json();
      if (!value || typeof value !== "object" || value.error) fail(502, "invalid upstream response");
      return value;
    };
    let status;
    try {
      const start = await post(this.config.baseUrl, transformedBody);
      if (typeof start.ticket !== "string" || !start.ticket) fail(502, "job returned no ticket");
      let workspace;
      let polls = 0;
      while (!workspace) {
        if (++polls > this.config.maxPolls) fail(504, "agent polling limit exceeded");
        const job = await post(this.config.baseUrl, { action: "status", ticket: start.ticket });
        if (this.config.terminalFailures.includes(job.status) || this.config.terminalFailures.includes(job.state)) fail(502, "job failed");
        workspace = job.workspace?.token;
        if (!workspace && job.status === "completed") fail(502, "job completed without a workspace");
        if (!workspace) await pause();
      }
      do {
        if (++polls > this.config.maxPolls) fail(504, "agent polling limit exceeded");
        const result = await post(this.config.workspaceUrl, { action: "status", token: workspace });
        status = result.status;
        if (!status || typeof status.state !== "string") fail(502, "invalid workspace status");
        if (this.config.terminalFailures.includes(status.state)) fail(502, "workspace failed");
        if (status.state !== "completed") await pause();
      } while (status.state !== "completed");
      if (typeof status.result?.submission !== "string" || !status.result.submission.trim()) fail(502, "workspace completed without a text submission");
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      return failure(timeout.signal.aborted ? 504 : error.status || 502, timeout.signal.aborted ? "agent deadline exceeded" : error.status ? error.message : "upstream request failed");
    } finally {
      clearTimeout(timer);
    }
    const usage = status.usage && {
      prompt_tokens: status.usage.prompt, completion_tokens: status.usage.completion,
      total_tokens: status.usage.prompt + status.usage.completion,
      prompt_tokens_details: { cached_tokens: status.usage.cached || 0 },
    };
    let message;
    try { message = { role: ROLE.ASSISTANT, ...toolMode.parse(status.result.submission) }; }
    catch (error) {
      const safeReasons = new Set(["json_syntax", "envelope_type", "nonce_mismatch", "calls_type", "content_type", "tool_policy", "call_type", "unknown_tool", "arguments_type"]);
      const reason = safeReasons.has(error.mlaiProtocolReason) ? ` (${error.mlaiProtocolReason})` : "";
      return failure(502, `invalid client tool protocol submission${reason}`);
    }
    const finishReason = message.tool_calls ? "tool_calls" : OPENAI_FINISH.STOP;
    const answer = {
      id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
    // Buffered SSE: the upstream agent has no native inference token stream.
    const chunk = (delta, finish = null) => ({
      id: answer.id, object: "chat.completion.chunk", created: answer.created, model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish && usage && !body.stream_options?.include_usage ? { usage } : {}),
    });
    const frames = [chunk({ role: ROLE.ASSISTANT, content: "" })];
    if (message.tool_calls) {
      if (message.content) frames.push(chunk({ content: message.content }));
      message.tool_calls.forEach((call, index) => frames.push(chunk({ tool_calls: [{ index, ...call }] })));
    } else frames.push(chunk({ content: message.content }));
    frames.push(chunk({}, finishReason));
    if (body.stream_options?.include_usage && usage) frames.push({ id: answer.id, object: "chat.completion.chunk", created: answer.created, model, choices: [], usage });
    const response = stream
      ? new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })
      : Response.json(answer);
    return {
      response, url: this.config.baseUrl,
      headers: { "Content-Type": "application/json" }, transformedBody,
    };
  }
}
