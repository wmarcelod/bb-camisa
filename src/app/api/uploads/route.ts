import { ensureServerSession, touchSession } from "@/lib/server/session";
import { deleteUpload, getSessionState, saveUpload } from "@/lib/server/repository";
import { MAX_BATCH_SIZE, MAX_FILE_SIZE_MB } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export async function POST(request: Request) {
  const sessionId = await ensureServerSession();
  const formData = await request.formData();
  const photo = formData.get("photo");
  const widthValue = Number(formData.get("width"));
  const heightValue = Number(formData.get("height"));
  const uploadId = formData.get("uploadId");

  if (!(photo instanceof File)) {
    return json({ error: "Envie um arquivo no campo photo." }, { status: 400 });
  }

  if (!photo.type.startsWith("image/")) {
    return json({ error: "O arquivo precisa ser uma imagem." }, { status: 400 });
  }

  if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue) || widthValue <= 0 || heightValue <= 0) {
    return json({ error: "Dimensoes invalidas para a imagem enviada." }, { status: 400 });
  }

  if (photo.size > MAX_FILE_SIZE_BYTES) {
    return json(
      {
        error: `A imagem ${photo.name} excede o limite de ${MAX_FILE_SIZE_MB} MB.`,
      },
      { status: 400 },
    );
  }

  const currentState = await getSessionState(sessionId);

  if (!uploadId && currentState.uploads.length >= MAX_BATCH_SIZE) {
    return json(
      {
        error: `O lote suporta no maximo ${MAX_BATCH_SIZE} fotos por sessao.`,
      },
      { status: 400 },
    );
  }

  const upload = await saveUpload({
    sessionId,
    file: photo,
    width: Math.round(widthValue),
    height: Math.round(heightValue),
    uploadId: typeof uploadId === "string" && uploadId ? uploadId : null,
  });
  await touchSession(sessionId);

  return json({ upload });
}

export async function DELETE(request: Request) {
  const sessionId = await ensureServerSession();
  const { uploadId } = (await request.json()) as { uploadId?: string };

  if (!uploadId) {
    return json({ error: "Informe o uploadId para remover." }, { status: 400 });
  }

  const removed = await deleteUpload(sessionId, uploadId);

  if (!removed) {
    return json({ error: "Upload nao encontrado." }, { status: 404 });
  }

  await touchSession(sessionId);

  return json({ success: true });
}
