"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { getNextKiroSocialPollInterval } from "@/lib/oauth/kiroSocialPoll";

/**
 * Kiro Social OAuth Modal (Google/GitHub)
 * Handles device code flow with automatic browser verification & polling.
 */
export default function KiroSocialOAuthModal({ isOpen, provider, onSuccess, onClose }) {
  const [step, setStep] = useState("loading"); // loading | polling | success | error
  const [authUrl, setAuthUrl] = useState("");
  const [userCode, setUserCode] = useState("");
  const [error, setError] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  const openedRef = useRef(false);
  const pollRef = useRef(null);
  const onSuccessRef = useRef(onSuccess);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  // Reset auto-open guard when modal closes
  useEffect(() => {
    if (!isOpen) {
      openedRef.current = false;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [isOpen]);

  // Initialize auth flow and start polling
  useEffect(() => {
    if (!isOpen || !provider) return;
    let cancelled = false;

    const stopPolling = () => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };

    const fail = (message) => {
      stopPolling();
      if (cancelled) return;
      setError(message);
      setStep("error");
    };

    const initAuth = async () => {
      try {
        setError(null);
        setStep("loading");

        const res = await fetch(`/api/oauth/kiro/social-authorize?provider=${provider}`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          throw new Error(data.error || "Failed to initialize authorization");
        }

        setUserCode(data.userCode || "");
        setAuthUrl(data.authUrl || "");
        setStep("polling");

        // Auto-open browser once per modal session
        if (!openedRef.current && data.authUrl) {
          openedRef.current = true;
          window.open(data.authUrl, "_blank");
        }

        const baseIntervalMs = Math.max(1, Number(data.interval) || 5) * 1000;
        let currentIntervalMs = baseIntervalMs;
        const expiresAt = Date.now() + Math.max(1, Number(data.expiresIn) || 300) * 1000;

        const schedule = (delayMs) => {
          if (cancelled) return;
          pollRef.current = setTimeout(poll, delayMs);
        };

        const poll = async () => {
          pollRef.current = null;
          if (cancelled) return;

          if (Date.now() >= expiresAt) {
            fail("Authorization session expired. Please try again.");
            return;
          }

          try {
            const pollRes = await fetch("/api/oauth/kiro/social-exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deviceCode: data.deviceCode, provider }),
            });

            const pollData = await pollRes.json();
            if (cancelled) return;

            if (pollData.success) {
              stopPolling();
              setStep("success");
              onSuccessRef.current?.();
              return;
            }

            if (!pollData.pending) {
              fail(pollData.error || "Authorization failed");
              return;
            }

            currentIntervalMs = getNextKiroSocialPollInterval(currentIntervalMs, pollData.error);
            schedule(currentIntervalMs);
          } catch {
            schedule(currentIntervalMs);
          }
        };

        schedule(baseIntervalMs);
      } catch (err) {
        fail(err.message);
      }
    };

    initAuth();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [isOpen, provider]);

  const handleClose = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    onClose();
  };

  const handleRetry = () => {
    openedRef.current = false;
    setStep("loading");
    setError(null);
  };

  const providerName = provider === "google" ? "Google" : "GitHub";

  return (
    <Modal
      isOpen={isOpen}
      title={`Connect Kiro via ${providerName}`}
      onClose={handleClose}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {/* Loading */}
        {step === "loading" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-primary animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Initializing...</h3>
            <p className="text-sm text-text-muted">
              Setting up {providerName} device authorization
            </p>
          </div>
        )}

        {/* Polling / Device Authorization Step */}
        {step === "polling" && (
          <div className="space-y-5 py-2">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-3">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400 mt-0.5">
                  info
                </span>
                <div className="flex-1 text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">Device Verification Flow</p>
                  <p>
                    A browser tab should have opened automatically. If not, open the URL below
                    and confirm the code to authorize 9router with your {providerName} account.
                  </p>
                </div>
              </div>
            </div>

            {/* Incognito Notice for Multi-Account */}
            <div className="bg-amber-50 dark:bg-amber-900/20 p-3.5 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex gap-2.5">
                <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-lg mt-0.5">
                  lightbulb
                </span>
                <div className="text-xs text-amber-800 dark:text-amber-200">
                  <p className="font-semibold mb-0.5">Menautkan Akun Kedua / Berbeda?</p>
                  <p>
                    Jika browser Anda sedang login ke akun {providerName} lain, silakan <strong>Copy</strong> URL verifikasi di bawah dan buka di jendela <strong>Incognito / Private Window</strong> agar tidak otomatis tersambung ke akun pertama.
                  </p>
                </div>
              </div>
            </div>

            {/* Verification Code Box */}
            {userCode && (
              <div className="text-center py-4 bg-sidebar border border-border rounded-xl">
                <p className="text-xs uppercase tracking-wider text-text-muted mb-1 font-medium">
                  Verification Code
                </p>
                <div className="flex items-center justify-center gap-3">
                  <span className="font-mono text-3xl font-bold tracking-widest text-primary">
                    {userCode}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={copied === "code" ? "check" : "content_copy"}
                    onClick={() => copy(userCode, "code")}
                    title="Copy code"
                  >
                    {copied === "code" ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}

            {/* Auth URL */}
            {authUrl && (
              <div>
                <p className="text-xs font-medium text-text-muted mb-1.5">Verification URL</p>
                <div className="flex gap-2">
                  <Input
                    value={authUrl}
                    readOnly
                    className="flex-1 font-mono text-xs select-all bg-background"
                  />
                  <Button
                    variant="secondary"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authUrl, "auth_url")}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="primary"
                    icon="open_in_new"
                    onClick={() => window.open(authUrl, "_blank")}
                  >
                    Open
                  </Button>
                </div>
              </div>
            )}

            {/* Pulsing Status */}
            <div className="flex items-center justify-center gap-2 pt-2 text-sm text-text-muted">
              <span className="material-symbols-outlined text-lg text-primary animate-spin">
                progress_activity
              </span>
              <span>Waiting for authorization in browser...</span>
            </div>

            <div className="pt-2">
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">
                check_circle
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">
              Your Kiro account via {providerName} has been connected and is ready to use.
            </p>
            <Button onClick={handleClose} fullWidth>
              Done
            </Button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={handleRetry} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

KiroSocialOAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  provider: PropTypes.oneOf(["google", "github"]).isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
