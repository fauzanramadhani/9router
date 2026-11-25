import { randomUUID } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../translator/schema/index.js";
import { validateMlaiCodeRequest } from "../services/mlaiCode.js";

// Agent adapter, not an inference endpoint. Never reuse remote workspaces across requests.
export class MlaiCodeExecutor extends BaseExecutor {
  constructor(config = PROVIDERS["mlai-code"]) {
    super("mlai-code", config);
  }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const failure = (status, message) => ({ response: Response.json({ error: { message: `ML AI Code: ${message}`, type: "mlai_code_error" } }, { status }), url: this.config.baseUrl, headers: {}, transformedBody: null });
    const allowedRoles = [ROLE.SYSTEM, ROLE.DEVELOPER, ROLE.USER, ROLE.ASSISTANT];
    const unsupported = validateMlaiCodeRequest(body || {});
    if (unsupported) return failure(400, unsupported);
    if (!Array.isArray(body?.messages) || !body.messages.length || body.tools?.length || body.functions?.length ||
        (body.n != null && body.n !== 1) || body.response_format ||
        body.messages.some(m => !m || !allowedRoles.includes(m.role) || m.tool_calls?.length || m.function_call || m.tool_call_id || m.audio ||
          !(typeof m.content === "string" || (Array.isArray(m.content) && m.content.every(p => p?.type === OPENAI_BLOCK.TEXT && typeof p.text === "string"))))) {
      return failure(400, "only text messages are supported; images, audio, files, tools, structured output and multiple choices are unsupported");
    }
    if (!credentials?.apiKey) return failure(401, "an mlai_sk API key is required");
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${credentials.apiKey}` };
    const task = JSON.stringify(body.messages.map(message => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : message.content.map(part => part.text).join("\n"),
    })));
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
    const answer = {
      id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: ROLE.ASSISTANT, content: status.result.submission }, finish_reason: OPENAI_FINISH.STOP }],
      ...(usage ? { usage } : {}),
    };
    // Buffered SSE: the upstream agent has no native inference token stream.
    const chunk = (delta, finish = null) => ({
      id: answer.id, object: "chat.completion.chunk", created: answer.created, model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(finish && usage ? { usage } : {}),
    });
    const frames = [chunk({ role: ROLE.ASSISTANT, content: "" }), chunk({ content: status.result.submission }), chunk({}, OPENAI_FINISH.STOP)];
    const response = stream
      ? new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })
      : Response.json(answer);
    return {
      response, url: this.config.baseUrl,
      headers: { "Content-Type": "application/json" }, transformedBody,
    };
  }
}
