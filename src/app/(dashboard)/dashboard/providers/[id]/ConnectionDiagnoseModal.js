"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Badge } from "@/shared/components";
import { translate } from "@/i18n/runtime";

export default function ConnectionDiagnoseModal({ isOpen, onClose, connection, availableModels = [], onDisableModel }) {
  const [selectedModel, setSelectedModel] = useState("cx/gpt-6-astra");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const accountTitle = connection?.name || connection?.email || connection?.id?.slice(0, 8) || "Account";

  const handleStartDiagnose = async () => {
    setRunning(true);
    setResult(null);
    setError("");

    try {
      const res = await fetch(`/api/providers/${connection.id}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          countNonStream: 5,
          countStream: 5
        })
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || translate("Diagnosis failed"));
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message || translate("Network error during diagnosis"));
    } finally {
      setRunning(false);
    }
  };

  const handleApplyDisable = async () => {
    if (!result?.model) return;
    const rawModel = result.model.includes("/") ? result.model.split("/").pop() : result.model;
    const current = Array.isArray(connection?.disabledModels) ? connection.disabledModels : [];
    const updated = [...new Set([...current, rawModel, result.model])];
    await onDisableModel(connection.id, updated);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${translate("Account Diagnosis")} — ${accountTitle}`} maxWidth="max-w-xl">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate("Test model stability (5x Non-Streaming & 5x Streaming) directly on this account to detect whether the account is compatible, stable, or failing.")}
        </p>

        {/* Model Selector & Run Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 border-b border-border pb-3">
          <div className="flex-1">
            <label className="text-[11px] font-medium text-text-muted block mb-1">{translate("Tested Model")}</label>
            <input
              type="text"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="e.g. cx/gpt-6-astra"
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="sm:self-end">
            <Button
              variant="primary"
              onClick={handleStartDiagnose}
              loading={running}
              disabled={!selectedModel.trim() || running}
            >
              {running ? translate("Testing...") : translate("Start Diagnosis")}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
            {error}
          </div>
        )}

        {/* Results view */}
        {result && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-black/5 dark:bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-main">{translate("Test Results:")}</span>
              {result.category === "stable" && (
                <Badge variant="success">🟢 {translate("STABLE")} ({result.totalSuccess}/{result.totalAttempted})</Badge>
              )}
              {result.category === "flaky" && (
                <Badge variant="warning">🟡 {translate("FLAKY")} ({result.totalSuccess}/{result.totalAttempted})</Badge>
              )}
              {result.category === "unsupported" && (
                <Badge variant="error">🔴 {translate("FAILING / UNSUPPORTED")} ({result.totalSuccess}/{result.totalAttempted})</Badge>
              )}
            </div>

            {/* Details */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-text-muted">{translate("Non-Streaming:")}</span>
                <span className="font-mono">{result.nonStreamResults.filter(r => r.success).length} / {result.nonStreamResults.length} {translate("Success")}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/50">
                <span className="text-text-muted">{translate("Streaming:")}</span>
                <span className="font-mono">{result.streamResults.filter(r => r.success).length} / {result.streamResults.length} {translate("Success")}</span>
              </div>

              {/* Sample Error */}
              {result.category !== "stable" && (
                <div className="pt-2">
                  <span className="text-text-muted block mb-1">{translate("Error Log:")}</span>
                  <div className="rounded bg-black/10 dark:bg-black/30 p-2 font-mono text-[11px] text-red-400 break-words">
                    {[...result.nonStreamResults, ...result.streamResults].find(r => !r.success)?.error || "Silent failure / empty content"}
                  </div>
                </div>
              )}
            </div>

            {/* Recommendation & One-Click Action */}
            {result.category !== "stable" && (
              <div className="mt-2 flex items-center justify-between rounded border border-amber-500/20 bg-amber-500/10 p-2">
                <span className="text-xs text-amber-500">
                  {translate("This model is unstable on this account. It is recommended to disable it.")}
                </span>
                <Button variant="danger" size="sm" onClick={handleApplyDisable}>
                  {translate("Disable This Model")}
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-3 mt-1">
          <Button variant="secondary" onClick={onClose} disabled={running}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ConnectionDiagnoseModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connection: PropTypes.object,
  availableModels: PropTypes.array,
  onDisableModel: PropTypes.func.isRequired,
};
