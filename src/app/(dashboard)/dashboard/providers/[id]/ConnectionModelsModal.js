"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Toggle, Badge } from "@/shared/components";
import { translate } from "@/i18n/runtime";

export default function ConnectionModelsModal({ isOpen, onClose, connection, availableModels = [], onSave }) {
  const [disabledList, setDisabledList] = useState([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && connection) {
      setDisabledList(Array.isArray(connection.disabledModels) ? [...connection.disabledModels] : []);
      setSearch("");
    }
  }, [isOpen, connection]);

  const filteredModels = useMemo(() => {
    if (!search.trim()) return availableModels;
    const q = search.toLowerCase();
    return availableModels.filter(m => {
      const id = typeof m === "string" ? m : (m.id || m.model || "");
      const name = typeof m === "object" ? (m.name || "") : "";
      return id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
  }, [availableModels, search]);

  const isModelDisabled = (modelId) => {
    const rawId = modelId.includes("/") ? modelId.split("/").pop() : modelId;
    return disabledList.includes(modelId) || disabledList.includes(rawId);
  };

  const toggleModel = (modelId) => {
    const rawId = modelId.includes("/") ? modelId.split("/").pop() : modelId;
    setDisabledList(prev => {
      const exists = prev.includes(modelId) || prev.includes(rawId);
      if (exists) {
        return prev.filter(x => x !== modelId && x !== rawId);
      } else {
        return [...prev, rawId];
      }
    });
  };

  const handleEnableAll = () => {
    setDisabledList([]);
  };

  const handleDisableGpt6 = () => {
    const gpt6Models = availableModels
      .map(m => typeof m === "string" ? m : (m.id || m.model || ""))
      .filter(id => id.toLowerCase().includes("gpt-6"))
      .map(id => id.includes("/") ? id.split("/").pop() : id);

    setDisabledList(prev => [...new Set([...prev, ...gpt6Models, "gpt-6-astra", "cx/gpt-6-astra"])]);
  };

  const distinctDisabledCount = useMemo(() => {
    const unique = new Set(disabledList.map(m => m.includes("/") ? m.split("/").pop() : m));
    return unique.size;
  }, [disabledList]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rawList = Array.from(new Set(disabledList.map(m => m.includes("/") ? m.split("/").pop() : m)));
      await onSave(connection.id, rawList);
      onClose();
    } catch (err) {
      console.error("Failed to save disabled models:", err);
    } finally {
      setSaving(false);
    }
  };

  const accountTitle = connection?.name || connection?.email || connection?.id?.slice(0, 8) || "Account";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${translate("Model Configuration")} — ${accountTitle}`} maxWidth="max-w-2xl">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          {translate("Select the models this account can serve. By default all models are active. Disabled models will never be routed to this account.")}
        </p>

        {/* Quick actions & Search */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="relative flex-1 min-w-[200px]">
            <span className="material-symbols-outlined absolute left-2.5 top-2 text-[18px] text-text-muted">search</span>
            <input
              type="text"
              placeholder={translate("Search models...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-bg py-1.5 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleEnableAll}
              className="rounded px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              {translate("Enable All")}
            </button>
            <button
              onClick={handleDisableGpt6}
              className="rounded px-2.5 py-1 text-xs font-medium text-amber-500 hover:bg-amber-500/10 transition-colors"
            >
              {translate("Disable GPT-6")}
            </button>
          </div>
        </div>

        {/* Model List */}
        <div className="max-h-[360px] overflow-y-auto space-y-1.5 pr-1">
          {filteredModels.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-muted">
              {translate("No models found.")}
            </div>
          ) : (
            filteredModels.map((m) => {
              const modelId = typeof m === "string" ? m : (m.id || m.model || "");
              const modelName = typeof m === "object" ? (m.name || modelId) : modelId;
              const disabled = isModelDisabled(modelId);

              return (
                <div
                  key={modelId}
                  className={`flex items-center justify-between rounded-lg border p-2.5 transition-colors ${
                    disabled
                      ? "border-red-500/20 bg-red-500/5 dark:bg-red-500/10"
                      : "border-border bg-bg hover:border-primary/40"
                  }`}
                >
                  <div className="flex flex-col min-w-0 pr-3">
                    <span className="truncate text-sm font-medium text-text-main">
                      {modelName}
                    </span>
                    <span className="truncate text-xs font-mono text-text-muted">
                      {modelId}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {disabled ? (
                      <Badge variant="error" size="sm">{translate("Disabled")}</Badge>
                    ) : (
                      <Badge variant="success" size="sm">{translate("Active")}</Badge>
                    )}
                    <Toggle
                      size="sm"
                      checked={!disabled}
                      onChange={() => toggleModel(modelId)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info & Buttons */}
        <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
          <span className="text-xs text-text-muted">
            {distinctDisabledCount > 0 ? `${distinctDisabledCount} ${translate("models disabled")}` : translate("All models active")}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {translate("Cancel")}
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {translate("Save Settings")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

ConnectionModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connection: PropTypes.object,
  availableModels: PropTypes.array,
  onSave: PropTypes.func.isRequired,
};
