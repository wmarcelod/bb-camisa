"use client";

import Image from "next/image";
import JSZip from "jszip";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { useEffect, useRef, useState } from "react";
import {
  cropImageFile,
  isThreeByFour,
  loadImageDimensions,
  TARGET_CROP_ASPECT,
} from "@/lib/image-processing";
import { MAX_BATCH_SIZE, MAX_FILE_SIZE_MB } from "@/lib/prompt";
import { formatBytes } from "@/lib/utils";

type StudioShellProps = {
  baseShirtPath: string;
  openAiConfigured: boolean;
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
};

type CropCandidate = UploadItem & {
  width: number;
  height: number;
};

type ResultItem = {
  id: string;
  fileName: string;
  status: "done" | "error";
  dataUrl?: string;
  outputFilename?: string;
  error?: string;
  requestId?: string;
};

type ProgressState = {
  current: number;
  total: number;
  fileName: string;
};

function toDataUrl(base64: string) {
  return `data:image/jpeg;base64,${base64}`;
}

function revokeItems(items: UploadItem[]) {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function revokeCropCandidates(items: CropCandidate[]) {
  for (const item of items) {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function dataUrlToBase64(value: string) {
  const [, base64 = ""] = value.split(",");
  return base64;
}

export function StudioShell({ baseShirtPath, openAiConfigured }: StudioShellProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  const cropQueueRef = useRef<CropCandidate[]>([]);
  const activeCropRef = useRef<CropCandidate | null>(null);

  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [cropQueue, setCropQueue] = useState<CropCandidate[]>([]);
  const [activeCrop, setActiveCrop] = useState<CropCandidate | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [isSavingCrop, setIsSavingCrop] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

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
      revokeItems(uploadsRef.current);
      revokeCropCandidates(cropQueueRef.current);

      if (activeCropRef.current) {
        URL.revokeObjectURL(activeCropRef.current.previewUrl);
      }
    };
  }, []);

  function openFilePicker() {
    if (!isPreparingFiles && !isGenerating) {
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

  async function appendFiles(fileList: FileList | File[]) {
    if (isPreparingFiles) {
      return;
    }

    const incoming = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (!incoming.length) {
      setFeedback("Selecione arquivos de imagem validos.");
      return;
    }

    const pendingCount =
      uploadsRef.current.length +
      cropQueueRef.current.length +
      (activeCropRef.current ? 1 : 0);
    const availableSlots = MAX_BATCH_SIZE - pendingCount;

    if (availableSlots <= 0) {
      setFeedback(`O lote suporta no maximo ${MAX_BATCH_SIZE} imagens por vez.`);
      return;
    }

    const selectedFiles = incoming.slice(0, availableSlots);
    const preparedFiles: CropCandidate[] = [];

    setIsPreparingFiles(true);

    try {
      for (const file of selectedFiles) {
        const { previewUrl, width, height } = await loadImageDimensions(file);

        preparedFiles.push({
          id: crypto.randomUUID(),
          file,
          previewUrl,
          width,
          height,
        });
      }

      const readyUploads: UploadItem[] = [];
      const needsCrop: CropCandidate[] = [];

      for (const file of preparedFiles) {
        if (isThreeByFour(file.width, file.height)) {
          readyUploads.push({
            id: file.id,
            file: file.file,
            previewUrl: file.previewUrl,
            width: file.width,
            height: file.height,
          });
        } else {
          needsCrop.push(file);
        }
      }

      if (readyUploads.length) {
        setUploads((current) => [...current, ...readyUploads]);
      }

      queueCropTasks(needsCrop);

      const messages: string[] = [];

      if (incoming.length > availableSlots) {
        messages.push(`Somente as primeiras ${availableSlots} imagens foram adicionadas ao lote.`);
      }

      if (needsCrop.length) {
        messages.push(
          `${needsCrop.length} imagem(ns) precisam de enquadramento 3x4 antes de entrar no lote.`,
        );
      }

      setFeedback(messages.length ? messages.join(" ") : null);
    } catch {
      revokeCropCandidates(preparedFiles);
      setFeedback("Nao foi possivel analisar uma das imagens. Tente novamente com outro arquivo.");
    } finally {
      setIsPreparingFiles(false);
    }
  }

  function removeUpload(id: string) {
    setUploads((current) => {
      const target = current.find((item) => item.id === id);

      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== id);
    });
  }

  function openManualCrop(id: string) {
    if (activeCropRef.current || isPreparingFiles || isGenerating) {
      return;
    }

    const target = uploadsRef.current.find((item) => item.id === id);

    if (!target) {
      return;
    }

    setUploads((current) => current.filter((item) => item.id !== id));
    setActiveCrop({
      id: target.id,
      file: target.file,
      previewUrl: target.previewUrl,
      width: target.width,
      height: target.height,
    });
  }

  function clearUploads() {
    revokeItems(uploadsRef.current);
    revokeCropCandidates(cropQueueRef.current);

    if (activeCropRef.current) {
      URL.revokeObjectURL(activeCropRef.current.previewUrl);
    }

    setUploads([]);
    setCropQueue([]);
    setActiveCrop(null);
    setResults([]);
    setFeedback(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }

  function skipCrop() {
    const target = activeCropRef.current;

    if (!target) {
      return;
    }

    URL.revokeObjectURL(target.previewUrl);
    setFeedback(`A imagem ${target.file.name} foi ignorada porque nao estava no formato 3x4.`);
    advanceCropQueue();
  }

  async function applyCrop() {
    const target = activeCropRef.current;

    if (!target || !croppedAreaPixels) {
      return;
    }

    setIsSavingCrop(true);

    try {
      const croppedFile = await cropImageFile(
        target.previewUrl,
        croppedAreaPixels,
        target.file,
      );
      const previewUrl = URL.createObjectURL(croppedFile);

      setUploads((current) => [
        ...current,
        {
          id: target.id,
          file: croppedFile,
          previewUrl,
          width: Math.round(croppedAreaPixels.width),
          height: Math.round(croppedAreaPixels.height),
        },
      ]);

      URL.revokeObjectURL(target.previewUrl);
      setFeedback(`Imagem ${target.file.name} ajustada para o enquadramento 3x4.`);
      advanceCropQueue();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel recortar a imagem selecionada.",
      );
    } finally {
      setIsSavingCrop(false);
    }
  }

  async function generateBatch() {
    if (!uploads.length || isGenerating || activeCrop || cropQueue.length) {
      return;
    }

    setIsGenerating(true);
    setResults([]);
    setFeedback(null);

    for (const [index, item] of uploads.entries()) {
      setProgress({
        current: index + 1,
        total: uploads.length,
        fileName: item.file.name,
      });

      try {
        const formData = new FormData();
        formData.append("photo", item.file);

        const response = await fetch("/api/generate", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as {
          error?: string;
          imageBase64?: string;
          outputFilename?: string;
          requestId?: string;
        };

        const imageBase64 = payload.imageBase64;

        if (!response.ok || !imageBase64) {
          throw new Error(payload.error || "Falha ao processar a imagem.");
        }

        setResults((current) => [
          ...current,
          {
            id: item.id,
            fileName: item.file.name,
            status: "done",
            dataUrl: toDataUrl(imageBase64),
            outputFilename: payload.outputFilename,
            requestId: payload.requestId,
          },
        ]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erro inesperado durante a geracao.";

        setResults((current) => [
          ...current,
          {
            id: item.id,
            fileName: item.file.name,
            status: "error",
            error: message,
          },
        ]);
      }
    }

    setIsGenerating(false);
    setProgress(null);
  }

  async function downloadAll() {
    const ready = results.filter((result) => result.status === "done" && result.dataUrl);

    if (!ready.length) {
      return;
    }

    const zip = new JSZip();

    for (const item of ready) {
      if (!item.dataUrl) {
        continue;
      }

      zip.file(item.outputFilename || `${item.id}.jpeg`, dataUrlToBase64(item.dataUrl), {
        base64: true,
      });
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bb-camisa-lote.zip";
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadOne(result: ResultItem) {
    if (!result.dataUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = result.outputFilename || `${result.id}.jpeg`;
    link.click();
  }

  const pendingCropCount = cropQueue.length + (activeCrop ? 1 : 0);

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">BB Camisa</p>
          <h1>Envie as fotos e gere o lote.</h1>
          <div className="hero-metrics">
            <span>Entrada 3x4</span>
            <span>Lote ate {MAX_BATCH_SIZE}</span>
            <span>Camisa fixa</span>
          </div>
        </div>
        <div className="status-card">
          <span className={`status-pill ${openAiConfigured ? "ready" : "warning"}`}>
            {openAiConfigured ? "Pronto" : "OpenAI pendente"}
          </span>
          <p>{openAiConfigured ? "Pode gerar." : "Falta OPENAI_API_KEY no Dokploy."}</p>
          <div className="status-grid">
            <div>
              <strong>Entrada</strong>
              <span>3 x 4</span>
            </div>
            <div>
              <strong>Saida</strong>
              <span>1024 x 1536</span>
            </div>
            <div>
              <strong>Lote</strong>
              <span>{MAX_BATCH_SIZE} imagens</span>
            </div>
            <div>
              <strong>Camisa</strong>
              <span>Base fixa</span>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Entrada</p>
              <h2>Fotos da pessoa</h2>
            </div>
            <button
              className="ghost-button"
              type="button"
              onClick={clearUploads}
              disabled={
                (!uploads.length && !pendingCropCount) || isGenerating || isPreparingFiles
              }
            >
              Limpar lote
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
              disabled={isPreparingFiles || isGenerating}
              onChange={(event) => {
                if (event.target.files) {
                  void appendFiles(event.target.files);
                }

                event.currentTarget.value = "";
              }}
            />
            <p className="dropzone-title">
              Solte as fotos aqui ou selecione.
            </p>
            <p className="dropzone-meta">
              Entrada 3x4. Se preciso, recorte antes de adicionar.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={openFilePicker}
              disabled={isPreparingFiles || isGenerating}
            >
              {isPreparingFiles ? "Analisando..." : "Escolher imagens"}
            </button>
          </div>

          {feedback ? <p className="feedback-line">{feedback}</p> : null}
          {pendingCropCount ? (
            <div className="crop-alert">
              <strong>{pendingCropCount} imagem(ns) pendente(s).</strong>
              <span>Finalize o recorte 3x4 para continuar.</span>
            </div>
          ) : null}

          <div className="upload-list">
            {uploads.length ? (
              uploads.map((item) => (
                <article className="upload-card" key={item.id}>
                  <div className="upload-thumb">
                    <Image alt={item.file.name} fill sizes="120px" src={item.previewUrl} unoptimized />
                  </div>
                  <div className="upload-meta">
                    <strong>{item.file.name}</strong>
                    <span>{formatBytes(item.file.size)}</span>
                    <small>
                      {item.width} x {item.height}
                    </small>
                  </div>
                  <div className="upload-actions">
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => openManualCrop(item.id)}
                      disabled={isGenerating || isPreparingFiles}
                    >
                      Ajustar
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => removeUpload(item.id)}
                      disabled={isGenerating || isPreparingFiles}
                    >
                      Remover
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <p>Nenhuma foto.</p>
                <span>Adicione imagens para montar o lote.</span>
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
                isSavingCrop ||
                Boolean(activeCrop) ||
                cropQueue.length > 0
              }
            >
              {isGenerating ? "Gerando..." : "Gerar lote"}
            </button>
            {progress ? (
              <p className="progress-line">
                Processando {progress.current}/{progress.total}: {progress.fileName}
              </p>
            ) : pendingCropCount ? (
              <p className="progress-line">Conclua os recortes pendentes.</p>
            ) : (
              <p className="progress-line">Pronto para gerar.</p>
            )}
          </div>
        </div>

        <div className="aside-stack">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Referencia 2</p>
                <h2>Camisa-base</h2>
              </div>
            </div>
            <div className="shirt-preview">
              <Image alt="Camisa-base" fill sizes="(max-width: 900px) 100vw, 420px" src={baseShirtPath} priority />
            </div>
            <p className="aside-note">Usada em todas as geracoes.</p>
          </div>
        </div>
      </section>

      <section className="panel results-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Saida</p>
            <h2>Resultados gerados</h2>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={downloadAll}
            disabled={!results.some((item) => item.status === "done")}
          >
            Baixar tudo em ZIP
          </button>
        </div>

        <div className="results-grid">
          {results.length ? (
            results.map((result) => (
              <article className={`result-card ${result.status}`} key={result.id}>
                {result.status === "done" && result.dataUrl ? (
                  <>
                    <div className="result-image">
                      <Image alt={result.fileName} fill sizes="(max-width: 900px) 100vw, 420px" src={result.dataUrl} unoptimized />
                    </div>
                    <div className="result-meta">
                      <strong>{result.fileName}</strong>
                      <span>Concluido</span>
                      {result.requestId ? <small>Request ID: {result.requestId}</small> : null}
                    </div>
                    <button className="primary-button" type="button" onClick={() => downloadOne(result)}>
                      Baixar imagem
                    </button>
                  </>
                ) : (
                  <>
                    <div className="result-error-badge">Falhou</div>
                    <div className="result-meta">
                      <strong>{result.fileName}</strong>
                      <span>{result.error}</span>
                    </div>
                  </>
                )}
              </article>
            ))
          ) : (
            <div className="empty-state results-empty">
              <p>Os resultados aparecem aqui.</p>
              <span>Falhas ficam isoladas por imagem.</span>
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
                <span>{activeCrop.width} x {activeCrop.height}</span>
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
                  onClick={applyCrop}
                  disabled={isSavingCrop || !croppedAreaPixels}
                >
                  {isSavingCrop ? "Aplicando..." : "Aplicar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
