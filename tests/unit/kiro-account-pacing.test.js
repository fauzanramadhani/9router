import { describe, expect, it } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

describe("Kiro per-account pacing and queueing", () => {
  it("spaces rapid requests on the same account key by the pacing interval", async () => {
    const executor = new KiroExecutor();
    process.env.KIRO_ACCOUNT_PACING_MS = "100"; // 100ms for fast unit test
    process.env.KIRO_INTEGRITY_GATE = "off";

    const creds = { connectionId: "acc-1" };
    const timestamps = [];

    // Mock super.execute
    const originalExecute = Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute;
    Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = async (args) => {
      timestamps.push(Date.now());
      return {
        response: new Response("event: test\n\ndata: {}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        })
      };
    };

    try {
      const p1 = executor.execute({ credentials: creds, body: {}, model: "claude-sonnet-5" });
      const p2 = executor.execute({ credentials: creds, body: {}, model: "claude-sonnet-5" });

      const [r1, r2] = await Promise.all([p1, p2]);
      await r1.response.text();
      await r2.response.text();

      expect(timestamps.length).toBe(2);
      const gap = timestamps[1] - timestamps[0];
      expect(gap).toBeGreaterThanOrEqual(80); // At least ~100ms gap
    } finally {
      Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = originalExecute;
      delete process.env.KIRO_ACCOUNT_PACING_MS;
      delete process.env.KIRO_INTEGRITY_GATE;
    }
  });

  it("allows different accounts to run concurrently without blocking each other", async () => {
    const executor = new KiroExecutor();
    process.env.KIRO_ACCOUNT_PACING_MS = "200";

    const timestamps = {};

    const originalExecute = Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute;
    Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = async (args) => {
      const id = args.credentials.connectionId;
      timestamps[id] = Date.now();
      await new Promise(r => setTimeout(r, 50));
      return {
        response: new Response("ok", { status: 200 })
      };
    };

    try {
      const p1 = executor.execute({ credentials: { connectionId: "acc-A" }, body: {}, model: "claude-sonnet-5" });
      const p2 = executor.execute({ credentials: { connectionId: "acc-B" }, body: {}, model: "claude-sonnet-5" });

      const [r1, r2] = await Promise.all([p1, p2]);
      await r1.response?.text?.();
      await r2.response?.text?.();

      const diff = Math.abs(timestamps["acc-A"] - timestamps["acc-B"]);
      // Both started at roughly the same time (no 200ms serialization across different accounts)
      expect(diff).toBeLessThan(80);
    } finally {
      Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = originalExecute;
      delete process.env.KIRO_ACCOUNT_PACING_MS;
      delete process.env.KIRO_INTEGRITY_GATE;
    }
  });

  it("holds lock across stream consumption duration", async () => {
    const executor = new KiroExecutor();
    process.env.KIRO_ACCOUNT_PACING_MS = "50";
    process.env.KIRO_INTEGRITY_GATE = "off";

    const creds = { connectionId: "acc-stream-hold" };
    const starts = [];
    const originalExecute = Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute;
    const originalTransform = executor.transformEventStreamToSSE;

    executor.transformEventStreamToSSE = (resp) => resp;

    let streamControllerRef;
    Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = async () => {
      starts.push(Date.now());
      const body = new ReadableStream({
        start(controller) {
          streamControllerRef = controller;
        }
      });
      return {
        response: new Response(body, {
          status: 200,
          headers: { "content-type": "text/event-stream" }
        })
      };
    };

    try {
      const p1 = executor.execute({ credentials: creds, body: {}, model: "claude-sonnet-5" });
      const p2 = executor.execute({ credentials: creds, body: {}, model: "claude-sonnet-5" });

      const r1 = await p1;
      expect(starts.length).toBe(1); // p2 must not have started yet because stream 1 is open

      // Read chunk 1
      streamControllerRef.enqueue(new TextEncoder().encode("chunk-1"));
      await new Promise(r => setTimeout(r, 100));
      expect(starts.length).toBe(1); // Still 1

      // Close stream 1
      streamControllerRef.close();
      await r1.response.text();

      // Now p2 should proceed and finish
      const r2 = await p2;
      streamControllerRef.close();
      await r2.response.text();
      expect(starts.length).toBe(2);
    } finally {
      Object.getPrototypeOf(Object.getPrototypeOf(executor)).execute = originalExecute;
      executor.transformEventStreamToSSE = originalTransform;
      delete process.env.KIRO_ACCOUNT_PACING_MS;
      delete process.env.KIRO_INTEGRITY_GATE;
    }
  });
});
