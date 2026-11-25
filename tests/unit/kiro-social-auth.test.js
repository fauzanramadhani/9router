import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyKiroSocialPoll,
  getNextKiroSocialPollInterval,
} from "../../src/lib/oauth/kiroSocialPoll.js";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

describe("Kiro Social Auth Polling Utilities", () => {
  it("classifies authorization_pending as pending", () => {
    const outcome = classifyKiroSocialPoll(true, 200, {
      status: "authorization_pending",
    });
    expect(outcome).toEqual({
      kind: "pending",
      error: "authorization_pending",
    });
  });

  it("classifies slow_down as pending", () => {
    const outcome = classifyKiroSocialPoll(true, 200, {
      error: "slow_down",
    });
    expect(outcome).toEqual({
      kind: "pending",
      error: "slow_down",
    });
  });

  it("increases interval on slow_down", () => {
    expect(getNextKiroSocialPollInterval(5000, "slow_down")).toBe(10000);
    expect(getNextKiroSocialPollInterval(5000, "authorization_pending")).toBe(5000);
    expect(getNextKiroSocialPollInterval(5000, null)).toBe(5000);
  });

  it("classifies error responses appropriately", () => {
    const outcome = classifyKiroSocialPoll(false, 400, {
      error: "access_denied",
    });
    expect(outcome).toEqual({
      kind: "error",
      error: "access_denied",
      status: 400,
    });
  });

  it("classifies invalid empty tokens as 502 error", () => {
    const outcome = classifyKiroSocialPoll(true, 200, {});
    expect(outcome).toEqual({
      kind: "error",
      error: "invalid_token_response",
      status: 502,
    });
  });

  it("classifies valid tokens as success", () => {
    const outcome = classifyKiroSocialPoll(true, 200, {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
    });
    expect(outcome).toEqual({ kind: "success" });
  });
});

describe("KiroService Social Device Auth Flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts social device authorization with correct loginProvider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        deviceCode: "DEV-1234",
        userCode: "ABCD-EFGH",
        verificationUriComplete: "https://app.kiro.dev/account/device?user_code=ABCD-EFGH&login_provider=Github",
        expiresInMilliseconds: 300000,
        intervalInMilliseconds: 5000,
      }),
    });

    const svc = new KiroService();
    const result = await svc.startSocialDeviceAuthorization("github");

    expect(result).toEqual({
      authUrl: "https://app.kiro.dev/account/device?user_code=ABCD-EFGH&login_provider=Github",
      deviceCode: "DEV-1234",
      userCode: "ABCD-EFGH",
      expiresIn: 300,
      interval: 5,
      provider: "github",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/oauth/device/authorization");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.loginProvider).toBe("Github");
    expect(body.clientId).toBe("kiro-cli");
  });

  it("polls social device token and returns pending status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "authorization_pending",
      }),
    });

    const svc = new KiroService();
    const result = await svc.pollSocialDeviceToken("DEV-1234");

    expect(result).toEqual({
      success: false,
      pending: true,
      error: "authorization_pending",
    });
  });

  it("polls social device token and returns tokens on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: "at-123",
        refreshToken: "rt-456",
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/p-abc",
        expiresIn: 3600,
      }),
    });

    const svc = new KiroService();
    const result = await svc.pollSocialDeviceToken("DEV-1234");

    expect(result).toEqual({
      success: true,
      pending: false,
      tokens: {
        accessToken: "at-123",
        refreshToken: "rt-456",
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789:profile/p-abc",
        expiresIn: 3600,
      },
    });
  });
});
