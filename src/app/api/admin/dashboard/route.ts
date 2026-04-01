import { isAuthorizedAdminRequest, getAdminTokenFromUrl } from "@/lib/server/admin";
import {
  estimateImageCostUsd,
  getDynamicImageParameterOptions,
  getGenerationSettings,
  listAvailableImageModels,
  saveGenerationSettings,
} from "@/lib/server/openai-image";
import { getAdminUsageSummary, listAdminGallery } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildDashboardResponse(token: string | null) {
  const [settings, items, models, summary] = await Promise.all([
    getGenerationSettings(),
    listAdminGallery(),
    listAvailableImageModels(),
    getAdminUsageSummary(),
  ]);
  const options = getDynamicImageParameterOptions();
  const averages = {
    averageInputTextTokens: summary.averageInputTextTokens,
    averageInputImageTokens: summary.averageInputImageTokens,
  };
  const itemsWithCosts = items.map((item) => {
    const estimatedLegacyUsd =
      item.estimatedCostUsd ?? estimateImageCostUsd(item.settings ?? settings, averages);

    return {
      ...item,
      imageUrl: token ? `${item.imageUrl}?token=${encodeURIComponent(token)}` : item.imageUrl,
      uploadImageUrl: token
        ? `${item.uploadImageUrl}?token=${encodeURIComponent(token)}`
        : item.uploadImageUrl,
      displayCostUsd: estimatedLegacyUsd,
      costMode: item.estimatedCostUsd != null ? "exact" : estimatedLegacyUsd != null ? "estimate" : "unknown",
    };
  });
  const estimatedCostPerImageUsd = estimateImageCostUsd(settings, averages);
  const estimatedLegacyUsd = itemsWithCosts.reduce((total, item) => {
    if (item.costMode !== "estimate" || item.displayCostUsd == null) {
      return total;
    }

    return total + item.displayCostUsd;
  }, 0);

  return {
    settings,
    models,
    options,
    summary: {
      ...summary,
      estimatedLegacyUsd,
      estimatedTotalUsd: summary.exactSpentUsd + estimatedLegacyUsd,
      estimatedCostPerImageUsd,
    },
    formula: {
      trackedSpend: "soma exata dos custos salvos por imagem",
      estimatedPerImage:
        "custo de saida do modelo/tamanho/qualidade + media de tokens de entrada (texto e imagem) x tabela do modelo",
      estimatedTotal:
        "gasto rastreado + estimativa das imagens sem custo salvo",
    },
    items: itemsWithCosts,
  };
}

export async function GET(request: Request) {
  if (!isAuthorizedAdminRequest(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  return Response.json(await buildDashboardResponse(getAdminTokenFromUrl(request.url)));
}

export async function POST(request: Request) {
  if (!isAuthorizedAdminRequest(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const payload = (await request.json()) as Record<string, unknown>;
  await saveGenerationSettings(payload);

  return Response.json(await buildDashboardResponse(getAdminTokenFromUrl(request.url)));
}
