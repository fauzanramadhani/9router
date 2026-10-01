import { NextResponse } from "next/server";
import { getProviderConnectionById, getApiKeys } from "@/models";
import { handleChat } from "@/sse/handlers/chat";

function isSilentOrPolicyError(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("usage policy") ||
    lower.includes("violating our usage policy") ||
    lower.includes("flagged as potentially violating") ||
    lower.includes("invalid prompt") ||
    lower.includes("prompt was flagged") ||
    lower.includes("moderation") ||
    lower.includes("[error]") ||
    lower.includes("policy violation") ||
    lower.includes("terms of use") ||
    lower.includes("safety system") ||
    lower.includes("content filter")
  );
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let internalKey = null;
    try {
      const keys = await getApiKeys();
      internalKey = keys?.find((k) => k.isActive !== false)?.key || null;
    } catch {}

    const incomingAuth = request.headers.get("Authorization");

    const body = await request.json().catch(() => ({}));
    let model = body.model || "cx/gpt-6-astra";
    if (!model.includes("/")) {
      const prefix = connection.provider === "codex" ? "cx" : connection.provider;
      model = `${prefix}/${model}`;
    }
    const countNonStream = Math.min(Math.max(body.countNonStream ?? 3, 0), 10);
    const countStream = Math.min(Math.max(body.countStream ?? 3, 0), 10);
    const promptText = body.prompt || "Tes koneksi, balas: OK";

    const nonStreamResults = [];
    const streamResults = [];

    // Helper to make internal chat request targeting this connection
    async function runTestIteration(isStream, iteration) {
      const startTime = Date.now();
      const headers = {
        "Content-Type": "application/json",
        "x-connection-id": id,
        "x-internal-diagnose": "true",
      };
      if (internalKey) {
        headers["Authorization"] = `Bearer ${internalKey}`;
      } else if (incomingAuth) {
        headers["Authorization"] = incomingAuth;
      }

      const mockReq = new Request("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          stream: isStream,
          messages: [{ role: "user", content: `${promptText} #${iteration}` }]
        })
      });

      try {
        const response = await handleChat(mockReq);
        const latency = Date.now() - startTime;
        const status = response.status;

        if (!isStream) {
          let json = {};
          let rawText = "";
          try {
            rawText = await response.text();
            try { json = JSON.parse(rawText); } catch {}
          } catch {}

          if (!response.ok || json.error) {
            const errMsg = json.error?.message || json.detail || json.message || rawText || `HTTP ${status}`;
            const isPolicy = isSilentOrPolicyError(errMsg);
            return {
              success: false,
              statusCode: status,
              latency,
              error: isPolicy ? `Silent error / Policy flag: ${errMsg}` : errMsg
            };
          }

          const choice = json.choices?.[0];
          const content = choice?.message?.content || "";
          const finishReason = choice?.finish_reason || "unknown";
          const isPolicyFlag = isSilentOrPolicyError(content);
          const hasValidContent = content.trim().length > 0;
          const ok = status === 200 && finishReason === "stop" && hasValidContent && !isPolicyFlag;

          let errorText = null;
          if (!ok) {
            if (isPolicyFlag) {
              errorText = `Silent error / Policy flag: ${content}`;
            } else if (!hasValidContent) {
              errorText = "Empty response content";
            } else if (finishReason !== "stop") {
              errorText = `Unfinished response (finish_reason: ${finishReason})`;
            } else {
              errorText = `Request failed with status ${status}`;
            }
          }

          return {
            success: ok,
            statusCode: status,
            latency,
            finishReason,
            content: content.slice(0, 120),
            error: errorText
          };
        } else {
          // Streaming
          if (!response.ok) {
            let errMsg = `HTTP ${status}`;
            try {
              const errText = await response.text();
              try {
                const errJson = JSON.parse(errText);
                errMsg = errJson.error?.message || errJson.detail || errJson.message || errText;
              } catch {
                errMsg = errText || errMsg;
              }
            } catch {}
            const isPolicy = isSilentOrPolicyError(errMsg);
            return {
              success: false,
              statusCode: status,
              latency,
              error: isPolicy ? `Silent error / Policy flag: ${errMsg}` : errMsg
            };
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";
          let finishReason = "none";
          let streamError = null;

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              const lines = text.split("\n");
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "data: [DONE]") continue;
                if (trimmed.startsWith("event: error")) {
                  streamError = "Stream received error event";
                  continue;
                }
                if (trimmed.startsWith("data: ")) {
                  const dataStr = trimmed.slice(6);
                  if (dataStr.startsWith("[Error]")) {
                    streamError = dataStr;
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(dataStr);
                    if (parsed.error) {
                      streamError = parsed.error.message || JSON.stringify(parsed.error);
                    } else if (parsed.detail) {
                      streamError = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
                    }
                    const delta = parsed.choices?.[0]?.delta?.content || "";
                    fullContent += delta;
                    if (parsed.choices?.[0]?.finish_reason) {
                      finishReason = parsed.choices[0].finish_reason;
                    }
                  } catch {
                    if (isSilentOrPolicyError(dataStr)) {
                      streamError = dataStr;
                    }
                  }
                }
              }
            }
          } catch (readErr) {
            streamError = readErr.message || "Stream read error";
          }

          const isPolicyFlag = isSilentOrPolicyError(fullContent) || isSilentOrPolicyError(streamError);
          const hasValidContent = fullContent.trim().length > 0;
          const ok = !streamError && finishReason === "stop" && hasValidContent && !isPolicyFlag;

          let errorText = null;
          if (!ok) {
            if (isPolicyFlag) {
              errorText = `Silent error / Policy flag: ${streamError || fullContent}`;
            } else if (streamError) {
              errorText = `Stream error: ${streamError}`;
            } else if (!hasValidContent) {
              errorText = "Empty stream response";
            } else if (finishReason !== "stop") {
              errorText = `Incomplete stream (finish_reason: ${finishReason})`;
            } else {
              errorText = "Stream request failed";
            }
          }

          return {
            success: ok,
            statusCode: response.status,
            latency,
            finishReason,
            content: fullContent.slice(0, 120),
            error: errorText
          };
        }
      } catch (err) {
        return {
          success: false,
          statusCode: 500,
          latency: Date.now() - startTime,
          error: err.message
        };
      }
    }

    // Run Non-Stream
    for (let i = 1; i <= countNonStream; i++) {
      const res = await runTestIteration(false, i);
      nonStreamResults.push(res);
      // Fast abort if 400 not supported
      if (i === 1 && res.statusCode === 400 && res.error?.toLowerCase().includes("not supported")) break;
    }

    // Run Stream (only if not unsupported)
    const earlyFail = nonStreamResults[0]?.statusCode === 400 && nonStreamResults[0]?.error?.toLowerCase().includes("not supported");
    if (!earlyFail) {
      for (let i = 1; i <= countStream; i++) {
        const res = await runTestIteration(true, i);
        streamResults.push(res);
      }
    }

    const totalSuccess = nonStreamResults.filter(r => r.success).length + streamResults.filter(r => r.success).length;
    const totalAttempted = nonStreamResults.length + streamResults.length;

    let category = "unsupported";
    if (totalSuccess === totalAttempted && totalAttempted > 0) {
      category = "stable";
    } else if (totalSuccess > 0) {
      category = "flaky";
    }

    return NextResponse.json({
      connectionId: id,
      accountName: connection.name || connection.email || id,
      model,
      category,
      totalSuccess,
      totalAttempted,
      nonStreamResults,
      streamResults,
      suggestedAction: category !== "stable" ? "disable_model" : "keep_active"
    });
  } catch (error) {
    console.error("Diagnostic error:", error);
    return NextResponse.json({ error: error.message || "Diagnostic failed" }, { status: 500 });
  }
}
