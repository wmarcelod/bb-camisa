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
  summary: {
    resultCount: number;
    keptCount: number;
    trackedCount: number;
    legacyCount: number;
    exactSpentUsd: number;
    estimatedLegacyUsd: number;
    estimatedTotalUsd: number;
    estimatedCostPerImageUsd: number | null;
    averageInputTextTokens: number;
    averageInputImageTokens: number;
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

export function CollectionDashboard({ token }: CollectionDashboardProps) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [draft, setDraft] = useState<GenerationSettings | null>(null);
  const [filter, setFilter] = useState<"all" | "kept" | "pending">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadDashboard() {
    setFeedback(null);

    try {
      const response = await fetch(`/api/admin/dashboard?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as DashboardPayload & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel carregar.");
      }

      setData(payload);
      setDraft(payload.settings);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Nao foi possivel carregar.");
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

  const filteredItems = data?.items.filter((item) => {
    if (filter === "kept") {
      return item.reviewStatus === "kept";
    }

    if (filter === "pending") {
      return item.reviewStatus !== "kept";
    }

    return true;
  });

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
            <strong>{formatUsd(data?.summary.exactSpentUsd ?? null)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Total estimado</span>
            <strong>{formatUsd(data?.summary.estimatedTotalUsd ?? null)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Estimativa por imagem</span>
            <strong>{formatUsd(data?.summary.estimatedCostPerImageUsd ?? null)}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Sem custo salvo</span>
            <strong>{data?.summary.legacyCount ?? 0}</strong>
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
                <span className="status-pill ready">Modelos ao vivo</span>
              </div>

              {draft && data ? (
                <div className="admin-form-grid">
                  <label className="admin-field">
                    <span>Modelo</span>
                    <select
                      value={draft.model}
                      onChange={(event) =>
                        setDraft({ ...draft, model: event.target.value })
                      }
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
                      {data.options.inputFidelity.map((value) => (
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

              <div className="admin-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={!draft || isSaving}
                >
                  {isSaving ? "Salvando..." : "Salvar configuracao"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void loadDashboard()}
                  disabled={isSaving}
                >
                  Atualizar
                </button>
              </div>
            </div>

            <div className="admin-formula-card">
              <div className="admin-card-header">
                <div>
                  <p className="eyebrow">Custo</p>
                  <h3>Formula</h3>
                </div>
              </div>
              <div className="formula-lines">
                <p>
                  <strong>Gasto rastreado</strong>
                  <span>{data?.formula.trackedSpend || "..."}</span>
                </p>
                <p>
                  <strong>Estimativa por imagem</strong>
                  <span>{data?.formula.estimatedPerImage || "..."}</span>
                </p>
                <p>
                  <strong>Total estimado</strong>
                  <span>{data?.formula.estimatedTotal || "..."}</span>
                </p>
              </div>
              <div className="formula-metrics">
                <span>Media texto: {Math.round(data?.summary.averageInputTextTokens ?? 0)} tokens</span>
                <span>Media imagem: {Math.round(data?.summary.averageInputImageTokens ?? 0)} tokens</span>
                <span>Legacy estimado: {formatUsd(data?.summary.estimatedLegacyUsd ?? null)}</span>
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
              </span>
            </div>

            {isLoading ? (
              <div className="empty-state results-empty">
                <p>Carregando...</p>
                <span>Buscando imagens.</span>
              </div>
            ) : filteredItems?.length ? (
              <div className="admin-gallery-grid">
                {filteredItems.map((item) => (
                  <article className="admin-gallery-card" key={item.id}>
                    <div className="admin-gallery-image">
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
                        <strong>{item.reviewStatus === "kept" ? "Boa" : "Gerada"}</strong>
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
