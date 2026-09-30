import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { handleChat } from "@/sse/handlers/chat";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const model = body.model || "cx/gpt-6-astra";
    const countNonStream = Math.min(Math.max(body.countNonStream ?? 3, 0), 10);
    const countStream = Math.min(Math.max(body.countStream ?? 3, 0), 10);
    const promptText = body.prompt || "Tes koneksi, balas: OK";

    const nonStreamResults = [];
    const streamResults = [];

    // Helper to make internal chat request targeting this connection
    async function runTestIteration(isStream, iteration) {
      const startTime = Date.now();
      const mockReq = new Request("http://localhost:20128/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-connection-id": id
        },
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
          const json = await response.json();
          if (!response.ok || json.error) {
            return {
              success: false,
              statusCode: status,
              latency,
              error: json.error?.message || `HTTP ${status}`
            };
          }
          const choice = json.choices?.[0];
          const content = choice?.message?.content || "";
          const finishReason = choice?.finish_reason || "unknown";
          const isPolicyFlag = content.includes("[Error]") || content.includes("usage policy");
          const ok = status === 200 && finishReason === "stop" && !isPolicyFlag;

          return {
            success: ok,
            statusCode: status,
            latency,
            finishReason,
            content: content.slice(0, 120),
            error: isPolicyFlag ? content : (finishReason === "failed" ? "finish_reason: failed" : null)
          };
        } else {
          // Streaming
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullContent = "";
          let finishReason = "none";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            const lines = text.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
                try {
                  const parsed = JSON.parse(line.slice(6));
                  fullContent += parsed.choices?.[0]?.delta?.content || "";
                  if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason;
                } catch (_) {}
              }
            }
          }

          const isPolicyFlag = fullContent.includes("[Error]") || fullContent.includes("usage policy");
          const ok = response.ok && (finishReason === "stop" || fullContent.length > 0) && !isPolicyFlag;

          return {
            success: ok,
            statusCode: response.status,
            latency,
            finishReason,
            content: fullContent.slice(0, 120),
            error: isPolicyFlag ? fullContent : (finishReason === "failed" ? "finish_reason: failed" : null)
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
      if (i === 1 && res.statusCode === 400 && res.error?.includes("not supported")) break;
    }

    // Run Stream (only if not unsupported)
    const earlyFail = nonStreamResults[0]?.statusCode === 400 && nonStreamResults[0]?.error?.includes("not supported");
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
