import { isAuthorizedAdminRequest, getAdminTokenFromUrl } from "@/lib/server/admin";
import {
  estimateImageCostUsd,
  getDynamicImageParameterOptions,
  getGenerationSettings,
  type GenerationSettings,
  listAvailableImageModels,
  saveGenerationSettings,
} from "@/lib/server/openai-image";
import { getAdminUsageSummary, listAdminGallery } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildAveragesForSettings(
  items: Awaited<ReturnType<typeof listAdminGallery>>,
  settings: GenerationSettings,
) {
  const sameModelUsages = items
    .filter((item) => item.estimatedCostUsd != null)
    .filter((item) => (item.settings?.model || settings.model) === settings.model)
    .map((item) => item.usage)
    .filter((usage): usage is NonNullable<typeof usage> => Boolean(usage));

  if (sameModelUsages.length) {
    const totals = sameModelUsages.reduce(
      (accumulator, usage) => ({
        text: accumulator.text + (usage.input_tokens_details?.text_tokens || 0),
        image: accumulator.image + (usage.input_tokens_details?.image_tokens || 0),
      }),
      { text: 0, image: 0 },
    );

    return {
      sampleCount: sameModelUsages.length,
      averageInputTextTokens: totals.text / sameModelUsages.length,
      averageInputImageTokens: totals.image / sameModelUsages.length,
    };
  }

  return null;
}

async function buildDashboardResponse(token: string | null) {
  const [settings, items, models, summary] = await Promise.all([
    getGenerationSettings(),
    listAdminGallery(),
    listAvailableImageModels(),
    getAdminUsageSummary(),
  ]);
  const options = getDynamicImageParameterOptions();
  const averages = buildAveragesForSettings(items, settings);
  const itemsWithCosts = items.map((item) => ({
    ...item,
    imageUrl: token ? `${item.imageUrl}?token=${encodeURIComponent(token)}` : item.imageUrl,
    uploadImageUrl: token
      ? `${item.uploadImageUrl}?token=${encodeURIComponent(token)}`
      : item.uploadImageUrl,
    actualCostUsd: item.estimatedCostUsd,
    hasRealCost: item.estimatedCostUsd != null,
  }));
  const estimatedCostPerImageUsd = averages
    ? estimateImageCostUsd(settings, averages)
    : null;
  const estimatedLegacyUsd =
    estimatedCostPerImageUsd != null ? summary.legacyCount * estimatedCostPerImageUsd : null;

  return {
    settings,
    models,
    options,
    summary: {
      ...summary,
      estimatedLegacyUsd,
      estimatedTotalUsd:
        estimatedLegacyUsd != null ? summary.exactSpentUsd + estimatedLegacyUsd : null,
      estimatedCostPerImageUsd,
      estimateSampleCount: averages?.sampleCount || 0,
    },
    formula: {
      trackedSpend: "soma exata dos custos salvos por imagem",
      estimatedPerImage:
        averages?.sampleCount
          ? "custo base de saida do modelo ativo + media de tokens de entrada das imagens reais do mesmo modelo"
          : "sem amostra real suficiente do modelo ativo para estimar com confianca",
      estimatedTotal:
        averages?.sampleCount
          ? "gasto rastreado + quantidade sem custo salvo x estimativa por imagem"
          : "estimativa desativada ate existir historico real do modelo ativo",
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
