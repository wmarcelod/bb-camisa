import path from "node:path";
import { promises as fs } from "node:fs";
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_OUTPUT_SIZE,
  EXACT_IMAGE_PROMPT,
} from "@/lib/prompt";
import { ensureServerSession, touchSession } from "@/lib/server/session";
import {
  getUploadForGeneration,
  markUploadError,
  markUploadProcessing,
  saveGenerationResult,
} from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/edits";
const BASE_SHIRT_PATH = path.join(process.cwd(), "public", "base-shirt.jpeg");

type OpenAiImageResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
  error?: {
    message?: string;
  };
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export async function POST(request: Request) {
  const sessionId = await ensureServerSession();

  if (!process.env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "A chave OPENAI_API_KEY nao esta configurada no servidor. Adicione a variavel no Dokploy para habilitar a geracao.",
      },
      { status: 503 },
    );
  }

  const payload = (await request.json()) as { uploadId?: string };
  const uploadId = payload.uploadId;

  if (!uploadId) {
    return json({ error: "Informe o uploadId para gerar a imagem." }, { status: 400 });
  }

  const upload = await getUploadForGeneration(sessionId, uploadId);

  if (!upload) {
    return json({ error: "Upload nao encontrado para esta sessao." }, { status: 404 });
  }

  const [photoBuffer, shirtBuffer] = await Promise.all([
    fs.readFile(upload.filePath),
    fs.readFile(BASE_SHIRT_PATH),
  ]);

  const openAiForm = new FormData();
  const requestId = crypto.randomUUID();
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  await markUploadProcessing(sessionId, uploadId);

  openAiForm.append(
    "image",
    new File([photoBuffer], upload.fileName || "modelo.jpg", {
      type: upload.mimeType || "image/jpeg",
    }),
  );
  openAiForm.append(
    "image",
    new File([shirtBuffer], "base-shirt.jpeg", {
      type: "image/jpeg",
    }),
  );
  openAiForm.append("model", model);
  openAiForm.append("prompt", EXACT_IMAGE_PROMPT);
  openAiForm.append("input_fidelity", "high");
  openAiForm.append("quality", "high");
  openAiForm.append("size", DEFAULT_OUTPUT_SIZE);
  openAiForm.append("background", "opaque");
  openAiForm.append("output_format", DEFAULT_OUTPUT_FORMAT);
  openAiForm.append("output_compression", "92");

  try {
    const openAiResponse = await fetch(OPENAI_IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "X-Client-Request-Id": requestId,
      },
      body: openAiForm,
    });

    const upstreamRequestId = openAiResponse.headers.get("x-request-id") || requestId;
    const payload = (await openAiResponse.json()) as OpenAiImageResponse;

    if (!openAiResponse.ok) {
      const message = payload.error?.message || "Falha ao gerar a imagem na OpenAI.";
      await markUploadError(sessionId, uploadId, message);

      return json(
        {
          error: message,
          requestId: upstreamRequestId,
        },
        { status: openAiResponse.status },
      );
    }

    const imageBase64 = payload.data?.[0]?.b64_json;

    if (!imageBase64) {
      await markUploadError(sessionId, uploadId, "A OpenAI respondeu sem imagem renderizada.");

      return json(
        {
          error: "A OpenAI respondeu sem imagem renderizada.",
          requestId: upstreamRequestId,
        },
        { status: 502 },
      );
    }

    const outputFilename = `${upload.fileName.replace(/\.[^.]+$/, "")}-bb-camisa.${DEFAULT_OUTPUT_FORMAT}`;
    const result = await saveGenerationResult({
      sessionId,
      uploadId,
      buffer: Buffer.from(imageBase64, "base64"),
      fileName: outputFilename,
      mimeType: `image/${DEFAULT_OUTPUT_FORMAT}`,
      requestId: upstreamRequestId,
    });
    await touchSession(sessionId);

    return json({
      result,
      revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha inesperada ao gerar a imagem.";
    await markUploadError(sessionId, uploadId, message);

    return json({ error: message, requestId }, { status: 500 });
  }
}
