import { isAuthorizedAdminRequest } from "@/lib/server/admin";
import {
  deleteAdminResult,
  updateAdminResultReviewStatus,
} from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAuthorizedAdminRequest(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    resultId?: string;
    action?: "keep" | "pending" | "delete";
  };

  if (!payload.resultId || !payload.action) {
    return Response.json({ error: "Informe resultId e action." }, { status: 400 });
  }

  if (payload.action === "delete") {
    const removed = await deleteAdminResult(payload.resultId);

    if (!removed) {
      return Response.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    return Response.json({ ok: true });
  }

  const reviewStatus = payload.action === "keep" ? "kept" : "pending";
  const updated = await updateAdminResultReviewStatus(payload.resultId, reviewStatus);

  if (!updated) {
    return Response.json({ error: "Imagem nao encontrada." }, { status: 404 });
  }

  return Response.json({ ok: true, reviewStatus });
}
