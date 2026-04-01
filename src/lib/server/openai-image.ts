import "server-only";

import { getDatabase } from "@/lib/server/database";
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_OUTPUT_SIZE,
} from "@/lib/prompt";

export type GenerationSettings = {
  model: string;
  quality: "auto" | "high" | "medium" | "low";
  size: "auto" | "1024x1024" | "1024x1536" | "1536x1024";
  background: "auto" | "opaque" | "transparent";
  outputFormat: "png" | "jpeg" | "webp";
  outputCompression: number;
  inputFidelity: "high" | "low";
  moderation: "auto" | "low";
};

export type UsageDetails = {
  text_tokens?: number;
  image_tokens?: number;
};

export type ImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: UsageDetails;
  output_tokens_details?: UsageDetails;
};

export type PriceTable = {
  textInputPer1M: number;
  textOutputPer1M: number;
  imageInputPer1M: number;
  imageOutputPer1M: number;
  perImage: Record<"low" | "medium" | "high", Record<"1024x1024" | "1024x1536" | "1536x1024", number>>;
};

type ModelApiResponse = {
  data?: Array<{
    id?: string;
  }>;
};

const SETTINGS_KEY = "generation_settings";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const MODEL_CACHE_TTL_MS = 1000 * 60 * 10;

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
  quality: "high",
  size: DEFAULT_OUTPUT_SIZE,
  background: "opaque",
  outputFormat: DEFAULT_OUTPUT_FORMAT,
  outputCompression: 92,
  inputFidelity: "high",
  moderation: "auto",
};

const MULTI_IMAGE_EDIT_MODEL_PREFIXES = ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"] as const;

const FALLBACK_IMAGE_MODELS = [
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
];

const PRICE_TABLES: Record<string, PriceTable> = {
  "gpt-image-1.5": {
    textInputPer1M: 5,
    textOutputPer1M: 10,
    imageInputPer1M: 8,
    imageOutputPer1M: 32,
    perImage: {
      low: {
        "1024x1024": 0.009,
        "1024x1536": 0.013,
        "1536x1024": 0.013,
      },
      medium: {
        "1024x1024": 0.034,
        "1024x1536": 0.05,
        "1536x1024": 0.05,
      },
      high: {
        "1024x1024": 0.133,
        "1024x1536": 0.2,
        "1536x1024": 0.2,
      },
    },
  },
  "chatgpt-image-latest": {
    textInputPer1M: 5,
    textOutputPer1M: 10,
    imageInputPer1M: 8,
    imageOutputPer1M: 32,
    perImage: {
      low: {
        "1024x1024": 0.009,
        "1024x1536": 0.013,
        "1536x1024": 0.013,
      },
      medium: {
        "1024x1024": 0.034,
        "1024x1536": 0.05,
        "1536x1024": 0.05,
      },
      high: {
        "1024x1024": 0.133,
        "1024x1536": 0.2,
        "1536x1024": 0.2,
      },
    },
  },
  "gpt-image-1": {
    textInputPer1M: 5,
    textOutputPer1M: 10,
    imageInputPer1M: 10,
    imageOutputPer1M: 40,
    perImage: {
      low: {
        "1024x1024": 0.011,
        "1024x1536": 0.016,
        "1536x1024": 0.016,
      },
      medium: {
        "1024x1024": 0.042,
        "1024x1536": 0.063,
        "1536x1024": 0.063,
      },
      high: {
        "1024x1024": 0.167,
        "1024x1536": 0.25,
        "1536x1024": 0.25,
      },
    },
  },
  "gpt-image-1-mini": {
    textInputPer1M: 2,
    textOutputPer1M: 8,
    imageInputPer1M: 2.5,
    imageOutputPer1M: 8,
    perImage: {
      low: {
        "1024x1024": 0.005,
        "1024x1536": 0.006,
        "1536x1024": 0.006,
      },
      medium: {
        "1024x1024": 0.011,
        "1024x1536": 0.015,
        "1536x1024": 0.015,
      },
      high: {
        "1024x1024": 0.036,
        "1024x1536": 0.052,
        "1536x1024": 0.052,
      },
    },
  },
};

declare global {
  var __bbCamisaModelCache:
    | {
        fetchedAt: number;
        models: string[];
      }
    | undefined;
}

function sortModels(models: string[]) {
  const priority = new Map(FALLBACK_IMAGE_MODELS.map((model, index) => [model, index]));

  return [...models].sort((left, right) => {
    const leftPriority = priority.get(left) ?? 999;
    const rightPriority = priority.get(right) ?? 999;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.localeCompare(right);
  });
}

function isSupportedImageEditModel(model: string) {
  return MULTI_IMAGE_EDIT_MODEL_PREFIXES.some(
    (prefix) => model === prefix || model.startsWith(`${prefix}-`),
  );
}

function normalizeModelId(model: string) {
  if (PRICE_TABLES[model]) {
    return model;
  }

  const snapshotPrefix = Object.keys(PRICE_TABLES).find((candidate) => model.startsWith(candidate));
  return snapshotPrefix || model;
}

function parseSettingsJson(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Partial<GenerationSettings>;
  } catch {
    return null;
  }
}

export function sanitizeGenerationSettings(input?: Partial<GenerationSettings> | null): GenerationSettings {
  const next: GenerationSettings = {
    model: input?.model || DEFAULT_GENERATION_SETTINGS.model,
    quality: input?.quality || DEFAULT_GENERATION_SETTINGS.quality,
    size: input?.size || DEFAULT_GENERATION_SETTINGS.size,
    background: input?.background || DEFAULT_GENERATION_SETTINGS.background,
    outputFormat: input?.outputFormat || DEFAULT_GENERATION_SETTINGS.outputFormat,
    outputCompression: Number.isFinite(input?.outputCompression)
      ? Number(input?.outputCompression)
      : DEFAULT_GENERATION_SETTINGS.outputCompression,
    inputFidelity: input?.inputFidelity || DEFAULT_GENERATION_SETTINGS.inputFidelity,
    moderation: input?.moderation || DEFAULT_GENERATION_SETTINGS.moderation,
  };

  if (!isSupportedImageEditModel(next.model)) {
    next.model = DEFAULT_GENERATION_SETTINGS.model;
  }

  if (!["auto", "high", "medium", "low"].includes(next.quality)) {
    next.quality = DEFAULT_GENERATION_SETTINGS.quality;
  }

  if (!["auto", "1024x1024", "1024x1536", "1536x1024"].includes(next.size)) {
    next.size = DEFAULT_GENERATION_SETTINGS.size;
  }

  if (!["auto", "opaque", "transparent"].includes(next.background)) {
    next.background = DEFAULT_GENERATION_SETTINGS.background;
  }

  if (!["png", "jpeg", "webp"].includes(next.outputFormat)) {
    next.outputFormat = DEFAULT_GENERATION_SETTINGS.outputFormat;
  }

  if (next.background === "transparent" && next.outputFormat === "jpeg") {
    next.outputFormat = "png";
  }

  next.outputCompression = Math.max(0, Math.min(100, Math.round(next.outputCompression)));

  if (!["high", "low"].includes(next.inputFidelity)) {
    next.inputFidelity = DEFAULT_GENERATION_SETTINGS.inputFidelity;
  }

  if (!["auto", "low"].includes(next.moderation)) {
    next.moderation = DEFAULT_GENERATION_SETTINGS.moderation;
  }

  return next;
}

export async function getGenerationSettings() {
  const database = await getDatabase();
  const row = database
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SETTINGS_KEY) as { value: string } | undefined;

  return sanitizeGenerationSettings(parseSettingsJson(row?.value));
}

export async function saveGenerationSettings(input: Partial<GenerationSettings>) {
  const database = await getDatabase();
  const settings = sanitizeGenerationSettings(input);
  const timestamp = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(SETTINGS_KEY, JSON.stringify(settings), timestamp);

  return settings;
}

export async function listAvailableImageModels(forceRefresh = false) {
  const cached = globalThis.__bbCamisaModelCache;
  const now = Date.now();

  if (!forceRefresh && cached && now - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cached.models;
  }

  if (!process.env.OPENAI_API_KEY) {
    return sortModels(FALLBACK_IMAGE_MODELS);
  }

  try {
    const response = await fetch(OPENAI_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Falha ao carregar modelos.");
    }

    const payload = (await response.json()) as ModelApiResponse;
    const models = sortModels(
      Array.from(
        new Set(
          (payload.data || [])
            .map((entry) => entry.id || "")
            .filter((model) => isSupportedImageEditModel(model)),
        ),
      ),
    );

    const nextModels = models.length ? models : sortModels(FALLBACK_IMAGE_MODELS);
    globalThis.__bbCamisaModelCache = {
      fetchedAt: now,
      models: nextModels,
    };

    return nextModels;
  } catch {
    return sortModels(FALLBACK_IMAGE_MODELS);
  }
}

export function getDynamicImageParameterOptions() {
  return {
    quality: ["auto", "high", "medium", "low"] as const,
    size: ["auto", "1024x1024", "1024x1536", "1536x1024"] as const,
    background: ["auto", "opaque", "transparent"] as const,
    outputFormat: ["png", "jpeg", "webp"] as const,
    inputFidelity: ["high", "low"] as const,
    moderation: ["auto", "low"] as const,
  };
}

export function getImagePricingTables(models?: string[]) {
  if (!models?.length) {
    return PRICE_TABLES;
  }

  return Object.fromEntries(
    models
      .map((model) => {
        const normalized = normalizeModelId(model);
        const table = PRICE_TABLES[normalized];
        return table ? [model, table] : null;
      })
      .filter((entry): entry is [string, PriceTable] => Boolean(entry)),
  );
}

export function calculateImageCostUsd(model: string, usage?: ImageUsage | null) {
  if (!usage) {
    return null;
  }

  const price = PRICE_TABLES[normalizeModelId(model)];

  if (!price) {
    return null;
  }

  const inputTextTokens = usage.input_tokens_details?.text_tokens || 0;
  const inputImageTokens = usage.input_tokens_details?.image_tokens || 0;
  const outputTextTokens = usage.output_tokens_details?.text_tokens || 0;
  const outputImageTokens = usage.output_tokens_details?.image_tokens || 0;

  return (
    (inputTextTokens / 1_000_000) * price.textInputPer1M +
    (inputImageTokens / 1_000_000) * price.imageInputPer1M +
    (outputTextTokens / 1_000_000) * price.textOutputPer1M +
    (outputImageTokens / 1_000_000) * price.imageOutputPer1M
  );
}

export function getOutputImageCostUsd(settings: GenerationSettings) {
  if (settings.quality === "auto" || settings.size === "auto") {
    return null;
  }

  const price = PRICE_TABLES[normalizeModelId(settings.model)];

  if (!price) {
    return null;
  }

  return price.perImage[settings.quality]?.[settings.size] ?? null;
}

export function estimateImageCostUsd(
  settings: GenerationSettings,
  averages?: {
    averageInputTextTokens: number;
    averageInputImageTokens: number;
    averageOutputTextTokens?: number;
  } | null,
) {
  const price = PRICE_TABLES[normalizeModelId(settings.model)];

  if (!price) {
    return null;
  }

  const outputCost = getOutputImageCostUsd(settings);

  if (outputCost == null) {
    return null;
  }

  const averageInputTextTokens = averages?.averageInputTextTokens || 0;
  const averageInputImageTokens = averages?.averageInputImageTokens || 0;
  const averageOutputTextTokens = averages?.averageOutputTextTokens || 0;

  return (
    outputCost +
    (averageInputTextTokens / 1_000_000) * price.textInputPer1M +
    (averageInputImageTokens / 1_000_000) * price.imageInputPer1M +
    (averageOutputTextTokens / 1_000_000) * price.textOutputPer1M
  );
}

export function formatUsd(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function buildSettingsSnapshot(settings: GenerationSettings) {
  return JSON.stringify(settings);
}
