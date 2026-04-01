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
    resultIds?: string[];
    action?: "keep" | "pending" | "delete";
  };
  const resultIds = payload.resultIds?.filter(Boolean) || [];
  const targetIds = resultIds.length
    ? resultIds
    : payload.resultId
      ? [payload.resultId]
      : [];

  if (!targetIds.length || !payload.action) {
    return Response.json({ error: "Informe resultId/resultIds e action." }, { status: 400 });
  }

  if (payload.action === "delete") {
    let removedCount = 0;

    for (const resultId of targetIds) {
      const removed = await deleteAdminResult(resultId);

      if (removed) {
        removedCount += 1;
      }
    }

    if (!removedCount) {
      return Response.json({ error: "Imagem nao encontrada." }, { status: 404 });
    }

    return Response.json({ ok: true, count: removedCount });
  }

  const reviewStatus = payload.action === "keep" ? "kept" : "pending";
  let updatedCount = 0;

  for (const resultId of targetIds) {
    const updated = await updateAdminResultReviewStatus(resultId, reviewStatus);

    if (updated) {
      updatedCount += 1;
    }
  }

  if (!updatedCount) {
    return Response.json({ error: "Imagem nao encontrada." }, { status: 404 });
  }

  return Response.json({ ok: true, reviewStatus, count: updatedCount });
}
