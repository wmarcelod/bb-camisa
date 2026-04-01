"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type GenerationSettings = {
  model: string;
  quality: "auto" | "high" | "medium" | "low";
  size: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "jpeg" | "webp";
  outputCompression: number;
  inputFidelity: "high" | "low";
  moderation: "auto" | "low";
};

type DashboardItem = {
  id: string;
  fileName: string;
  imageUrl: string;
  reviewStatus: "pending" | "kept";
  createdAt: string;
  originalName: string;
  actualCostUsd: number | null;
  hasRealCost: boolean;
};

type EstimateBasis = {
  sampleCount: number;
  averageInputTextTokens: number;
  averageInputImageTokens: number;
  averageOutputTextTokens: number;
  source: "sample" | "baseline";
};

type PriceTable = {
  textInputPer1M: number;
  textOutputPer1M: number;
  imageInputPer1M: number;
  imageOutputPer1M: number;
  perImage: Record<"low" | "medium" | "high", Record<"1024x1024" | "1024x1536" | "1536x1024", number>>;
};

type DashboardPayload = {
  settings: GenerationSettings;
  models: string[];
  options: {
    quality: Array<GenerationSettings["quality"]>;
    size: Array<GenerationSettings["size"]>;
    background: Array<GenerationSettings["background"]>;
    outputFormat: Array<GenerationSettings["outputFormat"]>;
    inputFidelity: Array<GenerationSettings["inputFidelity"]>;
    moderation: Array<GenerationSettings["moderation"]>;
  };
  inputFidelityOptionsByModel: Record<string, Array<GenerationSettings["inputFidelity"]>>;
  estimateBasisByModel: Record<
    string,
    Partial<Record<GenerationSettings["inputFidelity"], EstimateBasis>>
  >;
  priceTables: Record<string, PriceTable>;
  summary: {
    resultCount: number;
    keptCount: number;
    trackedCount: number;
    legacyCount: number;
    exactSpentUsd: number;
    trackedSpentUsd: number;
    estimatedLegacyUsd: number | null;
    estimatedTotalUsd: number | null;
    estimatedCostPerImageUsd: number | null;
    averageInputTextTokens: number;
    averageInputImageTokens: number;
    averageOutputTextTokens: number;
    estimateSampleCount: number;
    estimateSource: "sample" | "baseline";
  };
  formula: {
    trackedSpend: string;
    estimatedPerImage: string;
    estimatedTotal: string;
  };
  items: DashboardItem[];
};

type CollectionDashboardProps = {
  token: string;
};

const usdFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

function formatUsd(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "N/D";
  }

  return usdFormatter.format(value);
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function calculateEstimatedImageCost(
  settings: GenerationSettings,
  basis: EstimateBasis | null,
  priceTables: Record<string, PriceTable>,
) {
  if (settings.quality === "auto" || settings.size === "auto") {
    return null;
  }

  const price = priceTables[settings.model];

  if (!price) {
    return null;
  }

  const outputCost = price.perImage[settings.quality]?.[settings.size];

  if (outputCost == null) {
    return null;
  }

  return (
    outputCost +
    ((basis?.averageInputTextTokens || 0) / 1_000_000) * price.textInputPer1M +
    ((basis?.averageInputImageTokens || 0) / 1_000_000) * price.imageInputPer1M +
    ((basis?.averageOutputTextTokens || 0) / 1_000_000) * price.textOutputPer1M
  );
}

export function CollectionDashboard({ token }: CollectionDashboardProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [draft, setDraft] = useState<GenerationSettings | null>(null);
  const [filter, setFilter] = useState<"all" | "kept" | "pending">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [busyResult, setBusyResult] = useState<{
    id: string;
    action: "keep" | "pending" | "delete";
  } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function fetchDashboard(options?: {
    refreshModels?: boolean;
    preserveDraft?: boolean;
    clearFeedback?: boolean;
  }) {
    if (options?.clearFeedback !== false) {
      setFeedback(null);
    }

    try {
      const query = new URLSearchParams({ token });

      if (options?.refreshModels) {
        query.set("refreshModels", "1");
      }

      const response = await fetch(`/api/admin/dashboard?${query.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as DashboardPayload & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel carregar.");
      }

      setData(payload);
      if (!options?.preserveDraft) {
        setDraft(payload.settings);
      }
      setSelectedIds((current) =>
        current.filter((id) => payload.items.some((item) => item.id === id)),
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar.");
    }
  }

  async function loadDashboard() {
    await fetchDashboard();
  }

  async function refreshModelList() {
    if (isRefreshingModels) {
      return;
    }

    setIsRefreshingModels(true);

    try {
      await fetchDashboard({
        refreshModels: true,
        preserveDraft: true,
        clearFeedback: false,
      });
    } finally {
      setIsRefreshingModels(false);
    }
  }

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const response = await fetch(`/api/admin/dashboard?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as DashboardPayload & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Nao foi possivel carregar.");
        }

        if (!active) {
          return;
        }

        setData(payload);
        setDraft(payload.settings);
        setSelectedIds((current) =>
          current.filter((id) => payload.items.some((item) => item.id === id)),
        );
      } catch (error) {
        if (active) {
          setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [token]);

  async function saveSettings() {
    if (!draft) {
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/dashboard?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
      });
      const payload = (await response.json()) as DashboardPayload & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel salvar.");
      }

      setData(payload);
      setDraft(payload.settings);
      setFeedback("Configuracao salva.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  async function runResultAction(
    resultId: string | string[],
    action: "keep" | "pending" | "delete",
  ) {
    const targetIds = Array.isArray(resultId) ? resultId : [resultId];

    if (!targetIds.length) {
      return;
    }

    setBusyResult({ id: targetIds[0], action });
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/results?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resultIds: targetIds,
          action,
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel atualizar.");
      }

      await loadDashboard();
      setSelectedIds((current) => current.filter((id) => !targetIds.includes(id)));
      setFeedback(
        action === "delete"
          ? targetIds.length > 1
            ? `${targetIds.length} imagem(ns) removida(s).`
            : "Imagem removida."
          : action === "keep"
            ? targetIds.length > 1
              ? `${targetIds.length} imagem(ns) marcada(s) como boa.`
              : "Marcada como boa."
            : targetIds.length > 1
              ? `${targetIds.length} imagem(ns) voltaram para pendente.`
              : "Voltou para pendente.",
      );
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel atualizar.");
    } finally {
      setBusyResult(null);
    }
  }

  function toggleSelected(resultId: string) {
    setSelectedIds((current) =>
      current.includes(resultId)
        ? current.filter((id) => id !== resultId)
        : [...current, resultId],
    );
  }

  function toggleVisibleSelection() {
    if (!filteredItems?.length) {
      return;
    }

    const visibleIds = filteredItems.map((item) => item.id);
    const allVisibleSelected = visibleIds.every((id) => selectedIds.includes(id));

    setSelectedIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  const filteredItems = data?.items.filter((item) => {
    if (filter === "kept") {
      return item.reviewStatus === "kept";
    }

    if (filter === "pending") {
      return item.reviewStatus !== "kept";
    }

    return true;
  });
  const selectedVisibleCount =
    filteredItems?.filter((item) => selectedIds.includes(item.id)).length ?? 0;
  const previewBasis =
    (draft && data?.estimateBasisByModel[draft.model]?.[draft.inputFidelity]) ||
    (data
      ? data.estimateBasisByModel[data.settings.model]?.[data.settings.inputFidelity]
      : null) ||
    null;
  const inputFidelityOptions =
    (draft && data?.inputFidelityOptionsByModel[draft.model]) || data?.options.inputFidelity || [];
  const previewEstimatedPerImageUsd =
    draft && data
      ? calculateEstimatedImageCost(draft, previewBasis, data.priceTables)
      : (data?.summary.estimatedCostPerImageUsd ?? null);
  return (
    <main className="page-shell">
      <section className="panel collection-dashboard">
        <div className="panel-header collection-header">
          <div>
            <p className="eyebrow">Coleta</p>
            <h2>Imagens geradas</h2>
          </div>
          <a
            className="primary-button collection-link"
            href={`/api/admin/export?token=${encodeURIComponent(token)}`}
          >
            Baixar tudo
          </a>
        </div>

        {feedback ? <p className="feedback-line">{feedback}</p> : null}

        <div className="admin-summary-grid">
          <article className="admin-stat-card">
            <span>Imagens</span>
            <strong>{data?.summary.resultCount ?? 0}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Boas</span>
            <strong>{data?.summary.keptCount ?? 0}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Gasto rastreado</span>
            <strong>{formatUsd(data?.summary.trackedSpentUsd ?? null)}</strong>
          </article>
        </div>

        <div className="admin-layout">
          <section className="admin-side-panel">
            <div className="admin-settings-card">
              <div className="admin-card-header">
                <div>
                  <p className="eyebrow">OpenAI</p>
                  <h3>Geracao</h3>
                </div>
                <span className="status-pill ready">
                  {isRefreshingModels ? "Atualizando modelos" : "Modelos ao vivo"}
                </span>
              </div>

              {draft && data ? (
                <div className="admin-form-grid">
                  <label className="admin-field">
                    <span>Modelo</span>
                    <select
                      value={draft.model}
                      onFocus={() => void refreshModelList()}
                      onChange={(event) => {
                        const nextModel = event.target.value;
                        const nextInputFidelity =
                          data.inputFidelityOptionsByModel[nextModel]?.includes(draft.inputFidelity)
                            ? draft.inputFidelity
                            : (data.inputFidelityOptionsByModel[nextModel]?.[0] ?? "low");

                        setDraft({
                          ...draft,
                          model: nextModel,
                          inputFidelity: nextInputFidelity,
                        });
                      }}
                    >
                      {data.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Qualidade</span>
                    <select
                      value={draft.quality}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          quality: event.target.value as GenerationSettings["quality"],
                        })
                      }
                    >
                      {data.options.quality.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Tamanho</span>
                    <select
                      value={draft.size}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          size: event.target.value as GenerationSettings["size"],
                        })
                      }
                    >
                      {data.options.size.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Fundo</span>
                    <select
                      value={draft.background}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          background: event.target.value as GenerationSettings["background"],
                        })
                      }
                    >
                      {data.options.background.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Formato</span>
                    <select
                      value={draft.outputFormat}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          outputFormat: event.target.value as GenerationSettings["outputFormat"],
                        })
                      }
                    >
                      {data.options.outputFormat.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Input fidelity</span>
                    <select
                      value={draft.inputFidelity}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          inputFidelity: event.target.value as GenerationSettings["inputFidelity"],
                        })
                      }
                    >
                      {inputFidelityOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Moderation</span>
                    <select
                      value={draft.moderation}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          moderation: event.target.value as GenerationSettings["moderation"],
                        })
                      }
                    >
                      {data.options.moderation.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="admin-field">
                    <span>Compressao</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.outputCompression}
                      disabled={draft.outputFormat === "png"}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          outputCompression: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              ) : null}

              <div className="model-estimate-strip">
                <span>Custo estimado por imagem</span>
                <strong>{formatUsd(previewEstimatedPerImageUsd)}</strong>
              </div>

              <div className="admin-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={!draft || isSaving}
                >
                  {isSaving ? "Salvando..." : "Salvar configuracao"}
                </button>
              </div>
            </div>

          </section>

          <section className="admin-gallery-panel">
            <div className="admin-gallery-toolbar">
              <div className="filter-group">
                <button
                  className={filter === "all" ? "primary-button" : "ghost-button"}
                  type="button"
                  onClick={() => setFilter("all")}
                >
                  Todas
                </button>
                <button
                  className={filter === "kept" ? "primary-button" : "ghost-button"}
                  type="button"
                  onClick={() => setFilter("kept")}
                >
                  Boas
                </button>
                <button
                  className={filter === "pending" ? "primary-button" : "ghost-button"}
                  type="button"
                  onClick={() => setFilter("pending")}
                >
                  Pendentes
                </button>
              </div>
              <span className="collection-meta-line">
                {filteredItems?.length ?? 0} imagem(ns)
                {selectedVisibleCount ? ` | ${selectedVisibleCount} selecionada(s)` : ""}
              </span>
            </div>

            {selectedIds.length ? (
              <div className="selection-bar">
                <strong>{selectedIds.length} selecionada(s)</strong>
                <div className="selection-bar-actions">
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={toggleVisibleSelection}
                    disabled={Boolean(busyResult)}
                  >
                    {filteredItems?.length &&
                    filteredItems.every((item) => selectedIds.includes(item.id))
                      ? "Limpar visiveis"
                      : "Selecionar visiveis"}
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setSelectedIds([])}
                    disabled={Boolean(busyResult)}
                  >
                    Limpar
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void runResultAction(selectedIds, "keep")}
                    disabled={Boolean(busyResult)}
                  >
                    Marcar boas
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void runResultAction(selectedIds, "pending")}
                    disabled={Boolean(busyResult)}
                  >
                    Pendentes
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void runResultAction(selectedIds, "delete")}
                    disabled={Boolean(busyResult)}
                  >
                    Remover
                  </button>
                </div>
              </div>
            ) : null}

            {isLoading ? (
              <div className="empty-state results-empty">
                <p>Carregando...</p>
                <span>Buscando imagens.</span>
              </div>
            ) : filteredItems?.length ? (
              <div className="admin-gallery-grid">
                {filteredItems.map((item) => (
                  <article
                    className={`admin-gallery-card ${selectedIds.includes(item.id) ? "selected" : ""}`}
                    key={item.id}
                  >
                    <div className="admin-gallery-image">
                      <button
                        className={`admin-select-toggle ${selectedIds.includes(item.id) ? "selected" : ""}`}
                        type="button"
                        disabled={Boolean(busyResult)}
                        onClick={() => toggleSelected(item.id)}
                        aria-label={
                          selectedIds.includes(item.id)
                            ? "Remover da selecao"
                            : "Adicionar na selecao"
                        }
                      >
                        <span className="admin-select-indicator" aria-hidden="true">
                          {selectedIds.includes(item.id) ? "x" : ""}
                        </span>
                      </button>
                      <Image
                        alt={item.fileName}
                        fill
                        sizes="(max-width: 900px) 100vw, 360px"
                        src={item.imageUrl}
                        unoptimized
                      />
                    </div>
                    <div className="admin-gallery-meta">
                      <div className="admin-gallery-topline">
                        <strong>{item.reviewStatus === "kept" ? "Boa" : "Pendente"}</strong>
                        <span>{item.hasRealCost ? "Custo real" : "Sem custo salvo"}</span>
                      </div>
                      <span>{item.originalName}</span>
                      <small>{formatTimestamp(item.createdAt)}</small>
                      <small>
                        {item.hasRealCost
                          ? formatUsd(item.actualCostUsd)
                          : "Imagem antiga sem custo real salvo"}
                      </small>
                    </div>
                    <div className="admin-gallery-actions">
                      <button
                        className={item.reviewStatus === "kept" ? "primary-button" : "ghost-button"}
                        type="button"
                        disabled={Boolean(busyResult)}
                        onClick={() =>
                          void runResultAction(
                            item.id,
                            item.reviewStatus === "kept" ? "pending" : "keep",
                          )
                        }
                      >
                        {busyResult?.id === item.id &&
                        (busyResult.action === "keep" || busyResult.action === "pending")
                          ? "Salvando..."
                          : item.reviewStatus === "kept"
                            ? "Boa"
                            : "Marcar boa"}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        disabled={Boolean(busyResult)}
                        onClick={() => void runResultAction(item.id, "delete")}
                      >
                        {busyResult?.id === item.id && busyResult.action === "delete"
                          ? "Removendo..."
                          : "Remover"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state results-empty">
                <p>Nenhuma imagem.</p>
                <span>As geradas ficam salvas aqui.</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
