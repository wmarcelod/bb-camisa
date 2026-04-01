import path from "node:path";
import { promises as fs } from "node:fs";
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_OUTPUT_SIZE,
  EXACT_IMAGE_PROMPT,
  MAX_FILE_SIZE_MB,
} from "@/lib/prompt";
import { sanitizeFileStem } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/edits";
const BASE_SHIRT_PATH = path.join(process.cwd(), "public", "base-shirt.jpeg");
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

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
  if (!process.env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "A chave OPENAI_API_KEY nao esta configurada no servidor. Adicione a variavel no Dokploy para habilitar a geracao.",
      },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const photo = formData.get("photo");

  if (!(photo instanceof File)) {
    return json({ error: "Envie uma imagem valida no campo photo." }, { status: 400 });
  }

  if (!photo.type.startsWith("image/")) {
    return json({ error: "O arquivo enviado precisa ser uma imagem." }, { status: 400 });
  }

  if (photo.size > MAX_FILE_SIZE_BYTES) {
    return json(
      {
        error: `A imagem ${photo.name} excede o limite de ${MAX_FILE_SIZE_MB} MB.`,
      },
      { status: 400 },
    );
  }

  const [photoBuffer, shirtBuffer] = await Promise.all([
    photo.arrayBuffer(),
    fs.readFile(BASE_SHIRT_PATH),
  ]);

  const openAiForm = new FormData();
  const requestId = crypto.randomUUID();
  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;

  openAiForm.append(
    "image",
    new File([photoBuffer], photo.name || "modelo.jpg", {
      type: photo.type || "image/jpeg",
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
    return json(
      {
        error: payload.error?.message || "Falha ao gerar a imagem na OpenAI.",
        requestId: upstreamRequestId,
      },
      { status: openAiResponse.status },
    );
  }

  const imageBase64 = payload.data?.[0]?.b64_json;

  if (!imageBase64) {
    return json(
      {
        error: "A OpenAI respondeu sem imagem renderizada.",
        requestId: upstreamRequestId,
      },
      { status: 502 },
    );
  }

  const outputFilename = `${sanitizeFileStem(photo.name)}-bb-camisa.${DEFAULT_OUTPUT_FORMAT}`;

  return json({
    imageBase64,
    outputFilename,
    requestId: upstreamRequestId,
    revisedPrompt: payload.data?.[0]?.revised_prompt ?? null,
  });
}
