import { ensureServerSession, touchSession } from "@/lib/server/session";
import { updateResultSelection } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export async function POST(request: Request) {
  const sessionId = await ensureServerSession();
  const payload = (await request.json()) as {
    keepIds?: string[];
    deleteIds?: string[];
  };

  const keepIds = Array.isArray(payload.keepIds) ? payload.keepIds : [];
  const deleteIds = Array.isArray(payload.deleteIds) ? payload.deleteIds : [];

  if (!keepIds.length && !deleteIds.length) {
    return json({ error: "Nenhum resultado foi enviado para atualizacao." }, { status: 400 });
  }

  await updateResultSelection({
    sessionId,
    keepIds,
    deleteIds,
  });
  await touchSession(sessionId);

  return json({ success: true });
}
