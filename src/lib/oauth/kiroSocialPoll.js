/**
 * Utility functions for Kiro social login device-code polling.
 */

export function getNextKiroSocialPollInterval(currentIntervalMs, error) {
  return error === "slow_down" ? currentIntervalMs + 5000 : currentIntervalMs;
}

function errorCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "authorization_failed";
}

export function classifyKiroSocialPoll(responseOk, responseStatus, data = {}) {
  const progress = data?.error ?? data?.status;
  if (progress === "authorization_pending" || progress === "slow_down") {
    return { kind: "pending", error: progress };
  }

  if (!responseOk || data?.error) {
    const status = responseStatus >= 400 && responseStatus <= 599 ? responseStatus : 400;
    return { kind: "error", error: errorCode(data?.error), status };
  }

  if (!data?.accessToken && !data?.refreshToken) {
    return { kind: "error", error: "invalid_token_response", status: 502 };
  }

  return { kind: "success" };
}
