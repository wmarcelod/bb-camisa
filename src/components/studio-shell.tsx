"use client";

import Image from "next/image";
import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";
import { EXACT_IMAGE_PROMPT, MAX_BATCH_SIZE, MAX_FILE_SIZE_MB } from "@/lib/prompt";
import { formatBytes } from "@/lib/utils";

type StudioShellProps = {
  baseShirtPath: string;
  openAiConfigured: boolean;
};

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
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

function dataUrlToBase64(value: string) {
  const [, base64 = ""] = value.split(",");
  return base64;
}

export function StudioShell({ baseShirtPath, openAiConfigured }: StudioShellProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadsRef = useRef<UploadItem[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  useEffect(() => {
    return () => {
      revokeItems(uploadsRef.current);
    };
  }, []);

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function appendFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList).filter((file) => file.type.startsWith("image/"));

    if (!incoming.length) {
      setFeedback("Selecione arquivos de imagem validos.");
      return;
    }

    const availableSlots = MAX_BATCH_SIZE - uploads.length;

    if (availableSlots <= 0) {
      setFeedback(`O lote suporta no maximo ${MAX_BATCH_SIZE} imagens por vez.`);
      return;
    }

    const selected = incoming.slice(0, availableSlots).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    if (incoming.length > availableSlots) {
      setFeedback(`Somente as primeiras ${availableSlots} imagens foram adicionadas ao lote.`);
    } else {
      setFeedback(null);
    }

    setUploads((current) => [...current, ...selected]);
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

  function clearUploads() {
    revokeItems(uploads);
    setUploads([]);
    setFeedback(null);
  }

  async function generateBatch() {
    if (!uploads.length || isGenerating) {
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
        const message = error instanceof Error ? error.message : "Erro inesperado durante a geracao.";

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

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">BB Camisa Studio</p>
          <h1>Upload individual ou em lote para vestir a camisa-base com OpenAI.</h1>
          <p className="hero-text">
            O fluxo usa sempre a foto da pessoa como Imagem 1, a camisa salva no servidor como Imagem 2 e o prompt fixo
            no backend para manter consistencia no resultado.
          </p>
          <div className="hero-metrics">
            <span>Prompt travado no servidor</span>
            <span>Edicao com 2 imagens de referencia</span>
            <span>Lote de ate {MAX_BATCH_SIZE} fotos</span>
          </div>
        </div>
        <div className="status-card">
          <span className={`status-pill ${openAiConfigured ? "ready" : "warning"}`}>
            {openAiConfigured ? "OpenAI configurada" : "OpenAI pendente"}
          </span>
          <p>
            {openAiConfigured
              ? "A geracao ja pode ser executada assim que voce enviar as fotos."
              : "O deploy funciona, mas a geracao depende da variavel OPENAI_API_KEY no Dokploy."}
          </p>
          <div className="status-grid">
            <div>
              <strong>Formato</strong>
              <span>JPEG</span>
            </div>
            <div>
              <strong>Saida</strong>
              <span>1024 x 1536</span>
            </div>
            <div>
              <strong>Qualidade</strong>
              <span>High</span>
            </div>
            <div>
              <strong>Fidelidade</strong>
              <span>Input high</span>
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
            <button className="ghost-button" type="button" onClick={clearUploads} disabled={!uploads.length || isGenerating}>
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
              appendFiles(event.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  appendFiles(event.target.files);
                }
                event.currentTarget.value = "";
              }}
            />
            <p className="dropzone-title">Arraste imagens aqui ou selecione no computador.</p>
            <p className="dropzone-meta">
              Ate {MAX_BATCH_SIZE} arquivos por lote. Limite recomendado de {MAX_FILE_SIZE_MB} MB por imagem.
            </p>
            <button className="primary-button" type="button" onClick={openFilePicker}>
              Escolher imagens
            </button>
          </div>

          {feedback ? <p className="feedback-line">{feedback}</p> : null}

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
                  </div>
                  <button className="icon-button" type="button" onClick={() => removeUpload(item.id)} disabled={isGenerating}>
                    Remover
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <p>Nenhuma foto adicionada ainda.</p>
                <span>O lote pode ter uma unica foto ou varias para processar em sequencia.</span>
              </div>
            )}
          </div>

          <div className="action-row">
            <button
              className="primary-button"
              type="button"
              onClick={generateBatch}
              disabled={!uploads.length || isGenerating || !openAiConfigured}
            >
              {isGenerating ? "Gerando..." : "Gerar lote"}
            </button>
            {progress ? (
              <p className="progress-line">
                Processando {progress.current}/{progress.total}: {progress.fileName}
              </p>
            ) : (
              <p className="progress-line">O backend envia cada foto separadamente para manter controle do lote.</p>
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
            <p className="aside-note">Esta imagem fica no servidor e entra em toda requisicao como a segunda referencia visual.</p>
          </div>

          <div className="panel prompt-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Prompt fixo</p>
                <h2>Travado no backend</h2>
              </div>
            </div>
            <pre>{EXACT_IMAGE_PROMPT}</pre>
          </div>
        </div>
      </section>

      <section className="panel results-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Saida</p>
            <h2>Resultados gerados</h2>
          </div>
          <button className="ghost-button" type="button" onClick={downloadAll} disabled={!results.some((item) => item.status === "done")}>
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
                      <span>Render finalizado</span>
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
              <p>Os renders aparecem aqui apos o processamento.</p>
              <span>Se alguma imagem falhar, o lote continua e o erro fica isolado no card correspondente.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
