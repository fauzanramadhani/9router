import { executeMlaiNativeGateway } from "../services/mlaiCodeNativeGateway.js";
import { getMlaiNativeGrant } from "../services/mlaiNativeSession.js";
import { MlaiNativeError } from "../services/mlaiNativeErrors.js";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

// Native device-authenticated inference only. Never launch a cloud agent.
export class MlaiCodeExecutor extends BaseExecutor {
  constructor(config = PROVIDERS["mlai-code"]) { super("mlai-code", config); }

  async execute({ model, body, stream, credentials, signal, proxyOptions = null }) {
    const failure = (status, message, code) => ({ response: Response.json({ error: { message: `ML AI Code: ${message}`, type: "mlai_code_error", ...(code ? { code } : {}) } }, { status }), url: this.config.baseUrl, headers: {}, transformedBody: null });
    if (credentials?.providerSpecificData?.mlaiNative !== true) return failure(401, "native device login is required; API-key connections are not supported");
    if ((model !== undefined && model !== "main") || (body?.model !== undefined && !["main", "mlai/main", "mlai-code/main"].includes(body.model))) return failure(400, "only mlai/main is supported");
    try {
      const grant = await getMlaiNativeGrant(credentials, { signal, proxyOptions });
      const result = await executeMlaiNativeGateway({ grant, body, stream, signal, proxyOptions });
      if (!result.renewableRunFinished) return result;
      // Only an explicit pre-response run_finished rejection can be replayed, once.
      const next = await getMlaiNativeGrant(credentials, { signal, proxyOptions });
      return await executeMlaiNativeGateway({ grant: next, body, stream, signal, proxyOptions });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const safe = error instanceof MlaiNativeError;
      const result = failure(safe ? error.status : 502, safe ? error.message : "native device gateway request failed", safe ? error.code : undefined);
      if (safe && error.retryAfter) result.response.headers.set("Retry-After", error.retryAfter);
      return result;
    }
  }
}
