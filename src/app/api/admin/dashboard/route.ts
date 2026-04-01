import { isAuthorizedAdminRequest, getAdminTokenFromUrl } from "@/lib/server/admin";
import {
  estimateImageCostUsd,
  getDynamicImageParameterOptions,
  getInputFidelityOptionsForModel,
  getGenerationSettings,
  getImagePricingTables,
  type GenerationSettings,
  listAvailableImageModels,
  saveGenerationSettings,
} from "@/lib/server/openai-image";
import { getAdminUsageSummary, listAdminCostLedger, listAdminGallery } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_FLOW_BASELINE = {
  sampleCount: 1,
  averageInputTextTokens: 261,
  averageInputImageTokens: 13094,
  averageOutputTextTokens: 398,
  source: "baseline" as const,
};

const INPUT_FIDELITY_IMAGE_TOKEN_OFFSET = 12480;

function normalizeImageTokensForInputFidelity(
  imageTokens: number,
  fromFidelity: GenerationSettings["inputFidelity"],
  toFidelity: GenerationSettings["inputFidelity"],
) {
  if (fromFidelity === toFidelity) {
    return imageTokens;
  }

  const adjusted =
    toFidelity === "high"
      ? imageTokens + INPUT_FIDELITY_IMAGE_TOKEN_OFFSET
      : imageTokens - INPUT_FIDELITY_IMAGE_TOKEN_OFFSET;

  return Math.max(0, adjusted);
}

function getAppFlowBaseline(settings: GenerationSettings) {
  return {
    ...APP_FLOW_BASELINE,
    averageInputImageTokens: normalizeImageTokensForInputFidelity(
      APP_FLOW_BASELINE.averageInputImageTokens,
      "high",
      settings.inputFidelity,
    ),
  };
}

function buildAveragesForSettings(
  items: Awaited<ReturnType<typeof listAdminGallery>>,
  settings: GenerationSettings,
) {
  const sameModelUsages = items
    .filter((item) => item.estimatedCostUsd != null)
    .filter((item) => (item.settings?.model || settings.model) === settings.model)
    .map((item) => ({
      usage: item.usage,
      inputFidelity: item.settings?.inputFidelity || "high",
    }))
    .filter(
      (
        entry,
      ): entry is {
        usage: NonNullable<(typeof items)[number]["usage"]>;
        inputFidelity: GenerationSettings["inputFidelity"];
      } => Boolean(entry.usage),
    );

  if (sameModelUsages.length) {
    const totals = sameModelUsages.reduce(
      (accumulator, entry) => ({
        text: accumulator.text + (entry.usage.input_tokens_details?.text_tokens || 0),
        image:
          accumulator.image +
          normalizeImageTokensForInputFidelity(
            entry.usage.input_tokens_details?.image_tokens || 0,
            entry.inputFidelity,
            settings.inputFidelity,
          ),
        outputText:
          accumulator.outputText + (entry.usage.output_tokens_details?.text_tokens || 0),
      }),
      { text: 0, image: 0, outputText: 0 },
    );

    return {
      sampleCount: sameModelUsages.length,
      averageInputTextTokens: totals.text / sameModelUsages.length,
      averageInputImageTokens: totals.image / sameModelUsages.length,
      averageOutputTextTokens: totals.outputText / sameModelUsages.length,
      source: "sample" as const,
    };
  }

  return getAppFlowBaseline(settings);
}

async function buildDashboardResponse(token: string | null, refreshModels = false) {
  const [settings, items, models, summary, ledger] = await Promise.all([
    getGenerationSettings(),
    listAdminGallery(),
    listAvailableImageModels(refreshModels),
    getAdminUsageSummary(),
    listAdminCostLedger(),
  ]);
  const options = getDynamicImageParameterOptions();
  const averages = buildAveragesForSettings(items, settings);
  const estimateBasisByModel = Object.fromEntries(
    models.map((model) => [
      model,
      Object.fromEntries(
        getInputFidelityOptionsForModel(model).map((inputFidelity) => [
          inputFidelity,
          buildAveragesForSettings(items, { ...settings, model, inputFidelity }),
        ]),
      ),
    ]),
  );
  const inputFidelityOptionsByModel = Object.fromEntries(
    models.map((model) => [model, getInputFidelityOptionsForModel(model)]),
  );
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
    inputFidelityOptionsByModel,
    estimateBasisByModel,
    priceTables: getImagePricingTables(models),
    summary: {
      ...summary,
      estimatedLegacyUsd,
      trackedSpentUsd: summary.exactSpentUsd,
      estimatedTotalUsd:
        estimatedLegacyUsd != null ? summary.exactSpentUsd + estimatedLegacyUsd : null,
      estimatedCostPerImageUsd,
      estimateSampleCount: averages?.source === "sample" ? averages.sampleCount : 0,
      estimateSource: averages?.source || "baseline",
    },
    formula: {
      trackedSpend: "soma exata dos custos reais salvos por imagem",
      estimatedPerImage:
        averages?.source === "sample"
          ? "custo base de saida do modelo ativo + media de tokens de entrada das imagens reais do mesmo modelo"
          : "custo base do modelo ativo + baseline do seu fluxo real com 2 imagens de entrada",
      estimatedTotal:
        averages?.source === "sample"
          ? "gasto rastreado + quantidade sem custo salvo x estimativa por imagem"
          : "gasto rastreado + quantidade sem custo salvo x baseline estimado",
    },
    items: itemsWithCosts,
    ledger,
  };
}

export async function GET(request: Request) {
  if (!isAuthorizedAdminRequest(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const url = new URL(request.url);
  const refreshModels = url.searchParams.get("refreshModels") === "1";

  return Response.json(await buildDashboardResponse(getAdminTokenFromUrl(request.url), refreshModels));
}

export async function POST(request: Request) {
  if (!isAuthorizedAdminRequest(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const payload = (await request.json()) as Record<string, unknown>;
  await saveGenerationSettings(payload);

  return Response.json(await buildDashboardResponse(getAdminTokenFromUrl(request.url)));
}
