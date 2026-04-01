"use client";

import Image from "next/image";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cropImageFile,
  isThreeByFour,
  loadImageDimensions,
  TARGET_CROP_ASPECT,
} from "@/lib/image-processing";
import { MAX_BATCH_SIZE } from "@/lib/prompt";
import { formatBytes } from "@/lib/utils";

type StudioShellProps = {
  openAiConfigured: boolean;
};

type SessionUpload = {
  id: string;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  generationStatus: "uploaded" | "processing" | "generated" | "error";
  errorMessage: string | null;
  imageUrl: string;
  createdAt: string;
};

type SessionResult = {
  id: string;
  uploadId: string;
  fileName: string;
  imageUrl: string;
  reviewStatus: "pending" | "kept";
  requestId: string | null;
  createdAt: string;
};

type SessionPayload = {
  sessionId: string;
  uploads: SessionUpload[];
  results: SessionResult[];
};

type CropCandidate = {
  localId: string;
  uploadId?: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
};

const ACTIVITY_VERBS = {
  preparing: ["Preparando", "Lendo", "Organizando"],
  uploading: ["Salvando", "Enviando", "Gravando"],
  generating: ["Gerando", "Processando", "Finalizando"],
  cropping: ["Ajustando", "Salvando", "Atualizando"],
  marking: ["Marcando", "Salvando", "Atualizando"],
} as const;

function revokeCandidate(candidate: CropCandidate | null) {
  if (candidate) {
    URL.revokeObjectURL(candidate.previewUrl);
  }
}

export function StudioShell({ openAiConfigured }: StudioShellProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropQueueRef = useRef<CropCandidate[]>([]);
  const activeCropRef = useRef<CropCandidate | null>(null);

  const [uploads, setUploads] = useState<SessionUpload[]>([]);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [cropQueue, setCropQueue] = useState<CropCandidate[]>([]);
  const [activeCrop, setActiveCrop] = useState<CropCandidate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingCrop, setIsSavingCrop] = useState(false);
  const [isSavingSelection, setIsSavingSelection] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [activityTick, setActivityTick] = useState(0);

  useEffect(() => {
    cropQueueRef.current = cropQueue;
  }, [cropQueue]);

  useEffect(() => {
    activeCropRef.current = activeCrop;

    if (activeCrop) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    }
  }, [activeCrop]);

  useEffect(() => {
    return () => {
      cropQueueRef.current.forEach(revokeCandidate);
      revokeCandidate(activeCropRef.current);
    };
  }, []);

  const activeOperation = isGenerating
    ? "generating"
    : isUploading
      ? "uploading"
      : isPreparingFiles
        ? "preparing"
        : isSavingCrop
          ? "cropping"
          : isSavingSelection
            ? "marking"
            : null;

  useEffect(() => {
    if (!activeOperation) {
      setActivityTick(0);
      return;
    }

    const timer = window.setInterval(() => {
      setActivityTick((current) => current + 1);
    }, 900);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeOperation]);

  async function refreshSession() {
    const response = await fetch("/api/session", {
      cache: "no-store",
    });
    const payload = (await response.json()) as SessionPayload;

    setUploads(payload.uploads);
    setResults(payload.results);
    setSelectedResultIds((current) => {
      const currentSet = new Set(current);
      const next = payload.results
        .filter((result) => result.reviewStatus === "kept" || currentSet.has(result.id))
        .map((result) => result.id);

      return Array.from(new Set(next));
    });
  }

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const response = await fetch("/api/session", {
          cache: "no-store",
        });
        const payload = (await response.json()) as SessionPayload;

        if (!isMounted) {
          return;
        }

        setUploads(payload.uploads);
        setResults(payload.results);
        setSelectedResultIds(
          payload.results
            .filter((result) => result.reviewStatus === "kept")
            .map((result) => result.id),
        );
      } finally {
        if (isMounted) {
          setIsLoadingSession(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const resultsByUpload = useMemo(() => {
    const map = new Map<string, SessionResult>();

    for (const result of results) {
      map.set(result.uploadId, result);
    }

    return map;
  }, [results]);

  const localPendingCropCount = cropQueue.length + (activeCrop ? 1 : 0);
  const queuedUploadIds = new Set(
    [activeCrop, ...cropQueue]
      .map((candidate) => candidate?.uploadId)
      .filter((value): value is string => Boolean(value)),
  );
  const uploadsNeedingCrop = uploads.filter((upload) => !isThreeByFour(upload.width, upload.height));
  const pendingCropCount =
    localPendingCropCount +
    uploadsNeedingCrop.filter((upload) => !queuedUploadIds.has(upload.id)).length;

  function openFilePicker() {
    if (!isPreparingFiles && !isUploading && !isGenerating) {
      fileInputRef.current?.click();
    }
  }

  function queueCropTasks(tasks: CropCandidate[]) {
    if (!tasks.length) {
      return;
    }

    const combined = [...cropQueueRef.current, ...tasks];

    if (!activeCropRef.current) {
      const [next, ...rest] = combined;
      setActiveCrop(next ?? null);
      setCropQueue(rest);
      return;
    }

    setCropQueue(combined);
  }

  function advanceCropQueue() {
    const [next, ...rest] = cropQueueRef.current;
    setCropQueue(rest);
    setActiveCrop(next ?? null);
  }

  async function persistPreparedFiles(candidates: CropCandidate[]) {
    if (!candidates.length) {
      return [] as SessionUpload[];
    }

    setIsUploading(true);
    setProgressText(`Salvando ${candidates.length} foto(s)...`);
    const savedUploads: SessionUpload[] = [];

    try {
      for (const [index, candidate] of candidates.entries()) {
        setProgressText(
          `Salvando ${index + 1}/${candidates.length}: ${candidate.file.name}`,
        );

        const formData = new FormData();
        formData.append("photo", candidate.file);
        formData.append("width", String(candidate.width));
        formData.append("height", String(candidate.height));

        if (candidate.uploadId) {
          formData.append("uploadId", candidate.uploadId);
        }

        const response = await fetch("/api/uploads", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as {
          error?: string;
          upload?: SessionUpload;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Falha ao salvar a foto no servidor.");
        }

        if (!payload.upload) {
          throw new Error("O servidor nao retornou o upload salvo.");
        }

        savedUploads.push(payload.upload);
      }

      await refreshSession();
      return savedUploads;
    } catch (error) {
      if (savedUploads.length) {
        await refreshSession();
      }

      throw error;
    } finally {
      setIsUploading(false);
      setProgressText(null);
    }
  }

  async function appendFiles(fileList: FileList | File[]) {
    if (isPreparingFiles || isUploading) {
      return;
    }

    const incoming = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (!incoming.length) {
      setFeedback("Selecione imagens.");
      return;
    }

    const pendingCount = uploads.length;
    const availableSlots = MAX_BATCH_SIZE - pendingCount;

    if (availableSlots <= 0) {
      setFeedback(`Limite de ${MAX_BATCH_SIZE} fotos.`);
      return;
    }

    const selectedFiles = incoming.slice(0, availableSlots);
    const preparedFiles: CropCandidate[] = [];

    setIsPreparingFiles(true);

    try {
      for (const file of selectedFiles) {
        const { previewUrl, width, height } = await loadImageDimensions(file);
        const candidate: CropCandidate = {
          localId: crypto.randomUUID(),
          file,
          previewUrl,
          width,
          height,
        };

        preparedFiles.push(candidate);
      }

      const savedUploads = await persistPreparedFiles(preparedFiles);
      const uploadIdByLocalId = new Map(
        preparedFiles.map((candidate, index) => [candidate.localId, savedUploads[index]?.id]),
      );
      const cropCandidates = preparedFiles
        .filter((candidate) => !isThreeByFour(candidate.width, candidate.height))
        .map((candidate) => ({
          ...candidate,
          uploadId: uploadIdByLocalId.get(candidate.localId),
        }))
        .filter((candidate): candidate is CropCandidate & { uploadId: string } =>
          Boolean(candidate.uploadId),
        );

      queueCropTasks(cropCandidates);
      preparedFiles
        .filter((candidate) => isThreeByFour(candidate.width, candidate.height))
        .forEach(revokeCandidate);

      const notices: string[] = [];

      if (incoming.length > availableSlots) {
        notices.push(`Somente as primeiras ${availableSlots} fotos entraram.`);
      }

      if (cropCandidates.length) {
        notices.push(
          `${cropCandidates.length} foto(s) foram salvas e precisam de ajuste 3x4.`,
        );
      }

      setFeedback(notices.length ? notices.join(" ") : null);
    } catch (error) {
      preparedFiles.forEach(revokeCandidate);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel preparar as imagens.",
      );
    } finally {
      setIsPreparingFiles(false);
    }
  }

  async function openManualCrop(upload: SessionUpload) {
    if (activeCrop || isPreparingFiles || isUploading || isGenerating) {
      return;
    }

    const response = await fetch(upload.imageUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      setFeedback("Nao foi possivel carregar a foto para recorte.");
      return;
    }

    const blob = await response.blob();
    const file = new File([blob], upload.fileName, {
      type: blob.type || "image/jpeg",
      lastModified: Date.now(),
    });
    const previewUrl = URL.createObjectURL(file);

    setActiveCrop({
      localId: upload.id,
      uploadId: upload.id,
      file,
      previewUrl,
      width: upload.width,
      height: upload.height,
    });
  }

  async function removeUpload(uploadId: string) {
    const response = await fetch("/api/uploads", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uploadId }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setFeedback(payload.error || "Nao foi possivel remover.");
      return;
    }

    await refreshSession();
  }

  function clearLocalCropQueue() {
    cropQueueRef.current.forEach(revokeCandidate);
    revokeCandidate(activeCropRef.current);
    setCropQueue([]);
    setActiveCrop(null);
  }

  function toggleSelection(resultId: string) {
    setSelectedResultIds((current) =>
      current.includes(resultId)
        ? current.filter((id) => id !== resultId)
        : [...current, resultId],
    );
  }

  async function saveSelectedResults() {
    const keepIds = selectedResultIds.filter((id) => {
      const result = results.find((entry) => entry.id === id);
      return result && result.reviewStatus !== "kept";
    });

    if (!keepIds.length) {
      setFeedback("Nenhum resultado novo selecionado.");
      return;
    }

    setIsSavingSelection(true);

    try {
      const response = await fetch("/api/results", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keepIds,
          deleteIds: [],
        }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel marcar.");
      }

      await refreshSession();
      setFeedback("Marcadas.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Nao foi possivel marcar.",
      );
    } finally {
      setIsSavingSelection(false);
    }
  }

  async function deleteResult(resultId: string) {
    const response = await fetch("/api/results", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        keepIds: [],
        deleteIds: [resultId],
      }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setFeedback(payload.error || "Nao foi possivel remover.");
      return;
    }

    setSelectedResultIds((current) => current.filter((id) => id !== resultId));
    await refreshSession();
  }

  function skipCrop() {
    const target = activeCropRef.current;

    if (!target) {
      return;
    }

    revokeCandidate(target);
    advanceCropQueue();
    setFeedback("Ajuste depois.");
  }

  async function applyCrop() {
    const target = activeCropRef.current;

    if (!target || !croppedAreaPixels) {
      return;
    }

    setIsSavingCrop(true);

    try {
      const croppedFile = await cropImageFile(target.previewUrl, croppedAreaPixels, target.file);
      const previewUrl = URL.createObjectURL(croppedFile);
      const candidate: CropCandidate = {
        localId: target.localId,
        uploadId: target.uploadId,
        file: croppedFile,
        previewUrl,
        width: Math.round(croppedAreaPixels.width),
        height: Math.round(croppedAreaPixels.height),
      };

      revokeCandidate(target);
      advanceCropQueue();
      await persistPreparedFiles([candidate]);
      revokeCandidate(candidate);
      setFeedback("Foto ajustada.");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Nao foi possivel aplicar o recorte.",
      );
    } finally {
      setIsSavingCrop(false);
    }
  }

  async function generateBatch() {
    if (!uploads.length || isGenerating || activeCrop || cropQueue.length) {
      return;
    }

    const targets = uploads.filter((upload) => {
      const result = resultsByUpload.get(upload.id);
      return upload.generationStatus !== "processing" && !result;
    });

    if (!targets.length) {
      setFeedback("Nada para gerar.");
      return;
    }

    setIsGenerating(true);
    let failedCount = 0;

    try {
      for (const [index, upload] of targets.entries()) {
        setProgressText(`Gerando ${index + 1}/${targets.length}: ${upload.fileName}`);
        setUploads((current) =>
          current.map((item) =>
            item.id === upload.id
              ? { ...item, generationStatus: "processing", errorMessage: null }
              : item,
          ),
        );

        const response = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uploadId: upload.id }),
        });
        const payload = (await response.json()) as {
          error?: string;
          result?: SessionResult;
        };

        if (!response.ok || !payload.result) {
          failedCount += 1;

          setUploads((current) =>
            current.map((item) =>
              item.id === upload.id
                ? { ...item, generationStatus: "error", errorMessage: "Falha ao gerar" }
                : item,
            ),
          );
          continue;
        }

        setResults((current) => {
          const filtered = current.filter((item) => item.uploadId !== payload.result?.uploadId);
          return [payload.result as SessionResult, ...filtered];
        });
        setUploads((current) =>
          current.map((item) =>
            item.id === upload.id
              ? { ...item, generationStatus: "generated", errorMessage: null }
              : item,
          ),
        );
      }

      await refreshSession();
      setFeedback(failedCount ? `${failedCount} foto(s) nao foram geradas.` : null);
    } finally {
      setIsGenerating(false);
      setProgressText(null);
    }
  }

  const keptCount = results.filter((result) => result.reviewStatus === "kept").length;
  const savableSelectionCount = results.filter(
    (result) =>
      selectedResultIds.includes(result.id) && result.reviewStatus !== "kept",
  ).length;
  const liveVerb = activeOperation
    ? ACTIVITY_VERBS[activeOperation][activityTick % ACTIVITY_VERBS[activeOperation].length]
    : null;
  const liveProgressText = progressText || (liveVerb ? `${liveVerb}...` : null);
  const pendingResultUploads = uploads.filter((upload) => !resultsByUpload.has(upload.id));
  const generationInFlight = isGenerating || uploads.some((upload) => upload.generationStatus === "processing");

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">BB Camisa</p>
          <h1>Envie. Ajuste. Gere.</h1>
          <p className="hero-text">
            Carregue as fotos, enquadre o que sair de 3x4 e gere tudo no mesmo lote.
          </p>
          <div className="hero-metrics">
            <span>Entrada 3x4</span>
            <span>Lote ate {MAX_BATCH_SIZE}</span>
            <span>Fundo branco</span>
          </div>
        </div>
        <div className="status-card">
          <span className={`status-pill ${openAiConfigured ? "ready" : "warning"}`}>
            {openAiConfigured ? "Ativo" : "Indisponivel"}
          </span>
          <p>{openAiConfigured ? "Fluxo pronto para uso." : "Geracao indisponivel no momento."}</p>
          <div className="status-grid">
            <div>
              <strong>Uploads</strong>
              <span>{uploads.length}</span>
            </div>
            <div>
              <strong>Resultados</strong>
              <span>{results.length}</span>
            </div>
            <div>
              <strong>Selecionadas</strong>
              <span>{keptCount}</span>
            </div>
            <div>
              <strong>Limite</strong>
              <span>{MAX_BATCH_SIZE}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel workspace-panel">
        <div className="workflow-strip">
          <article className="workflow-step">
            <strong>1. Envie</strong>
            <span>Arraste ou selecione ate {MAX_BATCH_SIZE} fotos.</span>
          </article>
          <article className="workflow-step">
            <strong>2. Ajuste</strong>
            <span>Qualquer imagem fora de 3x4 abre para enquadramento.</span>
          </article>
          <article className="workflow-step">
            <strong>3. Gere</strong>
            <span>As imagens prontas aparecem abaixo para revisao.</span>
          </article>
        </div>

        <div className="panel-header">
          <div>
            <p className="eyebrow">Entrada</p>
            <h2>Fotos da pessoa</h2>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={clearLocalCropQueue}
            disabled={!localPendingCropCount}
          >
            Fechar recortes
          </button>
        </div>

        <div
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void appendFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            multiple
            disabled={isPreparingFiles || isUploading || isGenerating}
            onChange={(event) => {
              if (event.target.files) {
                void appendFiles(event.target.files);
              }

              event.currentTarget.value = "";
            }}
          />
          <p className="dropzone-title">Solte as fotos aqui ou selecione.</p>
          <p className="dropzone-meta">Entrada individual ou em lote.</p>
          <button
            className="primary-button"
            type="button"
            onClick={openFilePicker}
            disabled={isPreparingFiles || isUploading || isGenerating}
          >
            {isPreparingFiles || isUploading ? (
              <span className="button-content">
                <span className="button-spinner" aria-hidden="true" />
                {liveVerb ? `${liveVerb}...` : "Processando..."}
              </span>
            ) : (
              "Escolher imagens"
            )}
          </button>
        </div>

        {feedback ? <p className="feedback-line">{feedback}</p> : null}

        <div className="workspace-summary">
          <span>{uploads.length} no lote</span>
          <span>{results.length} geradas</span>
          <span>{keptCount} boas</span>
          <span>{pendingCropCount} pendente(s) 3x4</span>
        </div>

        {pendingCropCount ? (
          <div className="crop-alert">
            <strong>{pendingCropCount} foto(s) pendente(s).</strong>
            <span>Ajuste para 3x4 antes de gerar.</span>
          </div>
        ) : null}

        <div className="upload-list">
          {uploads.length ? (
            uploads.map((upload) => (
              <article className="upload-card" key={upload.id}>
                <div className="upload-thumb">
                  <Image
                    alt={upload.fileName}
                    fill
                    sizes="120px"
                    src={upload.imageUrl}
                    unoptimized
                  />
                </div>
                <div className="upload-meta">
                  <strong>{upload.fileName}</strong>
                  <span>{formatBytes(upload.fileSize)}</span>
                  <small>
                    {upload.width} x {upload.height}
                  </small>
                  <small
                    className={`status-copy ${
                      !isThreeByFour(upload.width, upload.height)
                        ? "warning"
                        : upload.generationStatus
                    }`}
                  >
                    {!isThreeByFour(upload.width, upload.height)
                      ? "Ajuste 3x4"
                      : upload.generationStatus === "generated"
                        ? "Gerada"
                        : upload.generationStatus === "processing"
                          ? "Gerando"
                          : upload.generationStatus === "error"
                            ? "Falha ao gerar"
                            : "Salva"}
                  </small>
                </div>
                <div className="upload-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void openManualCrop(upload)}
                    disabled={isGenerating || isPreparingFiles || isUploading || isSavingCrop}
                  >
                    Ajustar
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void removeUpload(upload.id)}
                    disabled={isGenerating || isPreparingFiles || isUploading || isSavingCrop}
                  >
                    Remover
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <p>{isLoadingSession ? "Carregando..." : "Nenhuma foto."}</p>
              <span>Adicione as imagens para iniciar o lote.</span>
            </div>
          )}
        </div>

        <div className="action-row">
          <button
            className="primary-button"
            type="button"
            onClick={generateBatch}
            disabled={
              !uploads.length ||
              isGenerating ||
              !openAiConfigured ||
              isPreparingFiles ||
              isUploading ||
              isSavingCrop ||
              pendingCropCount > 0
            }
          >
            {isGenerating ? (
              <span className="button-content">
                <span className="button-spinner" aria-hidden="true" />
                {liveVerb ? `${liveVerb}...` : "Gerando..."}
              </span>
            ) : (
              "Gerar lote"
            )}
          </button>
          <div className="progress-stack">
            <p className={`progress-line ${generationInFlight ? "active" : ""}`}>
              {generationInFlight ? (
                <span className="live-progress">
                  <span className="live-spinner" aria-hidden="true" />
                  {liveProgressText || "Gerando com a OpenAI..."}
                </span>
              ) : isPreparingFiles || isUploading ? (
                "As fotos salvas entram no lote acima."
              ) : pendingCropCount ? (
                "Ajuste as fotos fora de 3x4."
              ) : pendingResultUploads.length ? (
                "As fotos prontas para gerar aparecem abaixo como fila."
              ) : (
                "As geradas aparecem abaixo."
              )}
            </p>
            {generationInFlight ? (
              <div className="loading-track" aria-hidden="true">
                <span className="loading-bar" />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel results-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Saida</p>
            <h2>Resultados</h2>
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => void saveSelectedResults()}
            disabled={!savableSelectionCount || isSavingSelection}
          >
            {isSavingSelection ? "Marcando..." : `Marcar boas (${savableSelectionCount})`}
          </button>
        </div>
        <p className="results-note">Todas as imagens geradas aparecem aqui e ficam salvas.</p>

        <div className="results-grid">
          {results.length || pendingResultUploads.length ? (
            <>
              {results.map((result) => {
              const selected = selectedResultIds.includes(result.id);

              return (
                <article className={`result-card ${result.reviewStatus}`} key={result.id}>
                  <div className="result-image">
                    <Image
                      alt={result.fileName}
                      fill
                      sizes="(max-width: 900px) 100vw, 420px"
                      src={result.imageUrl}
                      unoptimized
                    />
                  </div>
                  <div className="result-meta">
                    <strong>{result.fileName}</strong>
                    <span>{result.reviewStatus === "kept" ? "Selecionada" : "Gerada"}</span>
                  </div>
                  <div className="result-actions">
                    <button
                      className={selected ? "primary-button" : "ghost-button"}
                      type="button"
                      onClick={() => toggleSelection(result.id)}
                    >
                      {selected ? "Selecionada" : "Selecionar"}
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => void deleteResult(result.id)}
                    >
                      Remover
                    </button>
                  </div>
                </article>
              );
              })}
              {pendingResultUploads.map((upload) => (
                <article className="result-card result-card-placeholder" key={`pending-${upload.id}`}>
                  <div className="result-image">
                    <Image
                      alt={upload.fileName}
                      fill
                      sizes="(max-width: 900px) 100vw, 420px"
                      src={upload.imageUrl}
                      unoptimized
                    />
                    <div className="result-image-overlay">
                      {upload.generationStatus === "processing" ? (
                        <span className="live-progress">
                          <span className="live-spinner" aria-hidden="true" />
                          Gerando
                        </span>
                      ) : upload.generationStatus === "error" ? (
                        <span>Falha</span>
                      ) : !isThreeByFour(upload.width, upload.height) ? (
                        <span>Ajuste 3x4</span>
                      ) : (
                        <span>Na fila</span>
                      )}
                    </div>
                  </div>
                  <div className="result-meta">
                    <strong>{upload.fileName}</strong>
                    <span>
                      {upload.generationStatus === "processing"
                        ? "Processando na OpenAI"
                        : upload.generationStatus === "error"
                          ? "Falha ao gerar"
                          : !isThreeByFour(upload.width, upload.height)
                            ? "Aguardando ajuste"
                            : "Aguardando geracao"}
                    </span>
                  </div>
                  <div className="result-actions">
                    <button className="ghost-button" type="button" disabled>
                      {upload.generationStatus === "processing" ? "Gerando..." : "Aguardando"}
                    </button>
                  </div>
                </article>
              ))}
            </>
          ) : (
            <div className="empty-state results-empty">
              <p>Nenhuma imagem gerada ainda.</p>
              <span>As imagens prontas aparecem aqui.</span>
            </div>
          )}
        </div>
      </section>

      {activeCrop ? (
        <div className="cropper-overlay" role="dialog" aria-modal="true">
          <div className="cropper-dialog">
            <div className="cropper-header">
              <div>
                <p className="eyebrow">Recorte</p>
                <h2>Ajuste para 3x4</h2>
              </div>
              <div className="cropper-queue">
                <strong>{pendingCropCount} restante(s)</strong>
                <span>
                  {activeCrop.width} x {activeCrop.height}
                </span>
              </div>
            </div>

            <div className="cropper-stage">
              <Cropper
                image={activeCrop.previewUrl}
                crop={crop}
                zoom={zoom}
                aspect={TARGET_CROP_ASPECT}
                showGrid={false}
                cropShape="rect"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
              />
            </div>

            <div className="cropper-footer">
              <div className="cropper-controls">
                <label className="slider-field">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.01"
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
                <p>Centralize a pessoa no quadro.</p>
              </div>

              <div className="cropper-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={skipCrop}
                  disabled={isSavingCrop}
                >
                  Ignorar
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void applyCrop()}
                  disabled={isSavingCrop || !croppedAreaPixels}
                >
                  {isSavingCrop ? "Salvando..." : "Salvar foto"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
