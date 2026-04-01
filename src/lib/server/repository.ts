import "server-only";

import path from "node:path";
import { promises as fs } from "node:fs";
import JSZip from "jszip";
import { getDatabase } from "@/lib/server/database";
import {
  ensureStorageStructure,
  resolveResultPath,
  resolveUploadPath,
} from "@/lib/server/storage";
import type { GenerationSettings, ImageUsage } from "@/lib/server/openai-image";
import { sanitizeFileStem } from "@/lib/utils";

export type UploadRecord = {
  id: string;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  generationStatus: "uploaded" | "processing" | "generated" | "error";
  errorMessage: string | null;
  imageUrl: string;
  createdAt: string;
};

export type ResultRecord = {
  id: string;
  uploadId: string;
  fileName: string;
  imageUrl: string;
  reviewStatus: "pending" | "kept" | "rejected";
  requestId: string | null;
  estimatedCostUsd: number | null;
  createdAt: string;
};

export type AdminGalleryItem = {
  id: string;
  sessionId: string;
  uploadId: string;
  fileName: string;
  imageUrl: string;
  reviewStatus: "pending" | "kept" | "rejected";
  requestId: string | null;
  createdAt: string;
  originalName: string;
  uploadImageUrl: string;
  estimatedCostUsd: number | null;
  usage: ImageUsage | null;
  settings: GenerationSettings | null;
};

export type AdminUsageSummary = {
  resultCount: number;
  keptCount: number;
  rejectedCount: number;
  trackedCount: number;
  legacyCount: number;
  exactSpentUsd: number;
  averageInputTextTokens: number;
  averageInputImageTokens: number;
  averageOutputTextTokens: number;
};

export type AdminCostLedgerItem = {
  id: string;
  resultId: string;
  fileName: string;
  originalName: string | null;
  estimatedCostUsd: number | null;
  requestId: string | null;
  createdAt: string;
  deletedAt: string | null;
  settings: GenerationSettings | null;
  status: "active" | "deleted";
};

type UploadRow = {
  id: string;
  original_name: string;
  file_size: number;
  width: number;
  height: number;
  generation_status: UploadRecord["generationStatus"];
  error_message: string | null;
  created_at: string;
};

type ResultRow = {
  id: string;
  upload_id: string;
  file_name: string;
  review_status: ResultRecord["reviewStatus"];
  request_id: string | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

type CollectionSessionRow = {
  id: string;
  created_at: string;
  updated_at: string;
  upload_count: number;
  result_count: number;
  kept_count: number;
};

type CollectionArchiveSessionRow = {
  id: string;
  created_at: string;
  updated_at: string;
};

type CollectionUploadRow = {
  session_id: string;
  upload_id: string;
  original_name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  width: number;
  height: number;
  generation_status: UploadRecord["generationStatus"];
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type CollectionResultRow = {
  session_id: string;
  result_id: string;
  upload_id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
  review_status: ResultRecord["reviewStatus"];
  request_id: string | null;
  usage_json: string | null;
  settings_json: string | null;
  estimated_cost_usd: number | null;
  created_at: string;
  updated_at: string;
};

type AdminResultRow = {
  id: string;
  session_id: string;
  upload_id: string;
  file_name: string;
  review_status: ResultRecord["reviewStatus"];
  request_id: string | null;
  estimated_cost_usd: number | null;
  usage_json: string | null;
  settings_json: string | null;
  created_at: string;
  original_name: string;
};

type AdminCostLedgerRow = {
  id: string;
  result_id: string;
  file_name: string;
  original_name: string | null;
  estimated_cost_usd: number | null;
  request_id: string | null;
  created_at: string;
  deleted_at: string | null;
  settings_json: string | null;
  status: "active" | "deleted";
};

function nowIso() {
  return new Date().toISOString();
}

function ensureColumn(
  database: Awaited<ReturnType<typeof getDatabase>>,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const columns = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function ensureRepositorySchema(database: Awaited<ReturnType<typeof getDatabase>>) {
  ensureColumn(database, "results", "usage_json", "TEXT");
  ensureColumn(database, "results", "settings_json", "TEXT");
  ensureColumn(database, "results", "estimated_cost_usd", "REAL");

  database.exec(`
    CREATE TABLE IF NOT EXISTS result_cost_log (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      upload_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      request_id TEXT,
      usage_json TEXT,
      settings_json TEXT,
      estimated_cost_usd REAL,
      created_at TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
  `);

  ensureColumn(database, "result_cost_log", "request_id", "TEXT");
  ensureColumn(database, "result_cost_log", "usage_json", "TEXT");
  ensureColumn(database, "result_cost_log", "settings_json", "TEXT");
  ensureColumn(database, "result_cost_log", "estimated_cost_usd", "REAL");
  ensureColumn(database, "result_cost_log", "created_at", "TEXT");
  ensureColumn(database, "result_cost_log", "deleted_at", "TEXT");
}

function getExtension(filename: string, mimeType: string) {
  const fromName = path.extname(filename).replace(".", "").toLowerCase();

  if (fromName) {
    return fromName;
  }

  if (mimeType === "image/png") {
    return "png";
  }

  if (mimeType === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function buildArchiveFileName(id: string, filename: string, mimeType: string) {
  const extension = path.extname(filename) || `.${getExtension(filename, mimeType)}`;
  return `${id}-${sanitizeFileStem(filename)}${extension.toLowerCase()}`;
}

function parseJson<T>(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function buildUploadRecord(row: UploadRow): UploadRecord {
  return {
    id: row.id,
    fileName: row.original_name,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    generationStatus: row.generation_status,
    errorMessage: row.error_message,
    imageUrl: `/api/files/upload/${row.id}`,
    createdAt: row.created_at,
  };
}

function buildResultRecord(row: ResultRow): ResultRecord {
  return {
    id: row.id,
    uploadId: row.upload_id,
    fileName: row.file_name,
    imageUrl: `/api/files/result/${row.id}`,
    reviewStatus: row.review_status,
    requestId: row.request_id,
    estimatedCostUsd: row.estimated_cost_usd,
    createdAt: row.created_at,
  };
}

async function deleteFileIfExists(targetPath: string) {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function archiveResultCostLog(params: {
  id: string;
  session_id: string;
  upload_id: string;
  file_name: string;
  request_id: string | null;
  usage_json?: string | null;
  settings_json?: string | null;
  estimated_cost_usd?: number | null;
  created_at: string;
}) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const deletedAt = nowIso();

  database
    .prepare(
      `INSERT OR IGNORE INTO result_cost_log (
         id, result_id, session_id, upload_id, file_name, request_id, usage_json, settings_json,
         estimated_cost_usd, created_at, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      params.id,
      params.session_id,
      params.upload_id,
      params.file_name,
      params.request_id || null,
      params.usage_json || null,
      params.settings_json || null,
      params.estimated_cost_usd ?? null,
      params.created_at,
      deletedAt,
    );
}

export async function getSessionState(sessionId: string) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const uploads = database
    .prepare(
      `SELECT id, original_name, file_size, width, height, generation_status, error_message, created_at
       FROM uploads
       WHERE session_id = ?
       ORDER BY created_at DESC`,
    )
    .all(sessionId) as UploadRow[];
  const results = database
    .prepare(
      `SELECT id, upload_id, file_name, review_status, request_id, estimated_cost_usd, created_at
       FROM results
       WHERE session_id = ? AND 1=1
       AND id NOT IN (SELECT result_id FROM result_cost_log)
       ORDER BY created_at DESC`,
    )
    .all(sessionId) as ResultRow[];

  return {
    uploads: uploads.map(buildUploadRecord),
    results: results.map(buildResultRecord),
  };
}

export async function saveUpload(params: {
  sessionId: string;
  file: File;
  width: number;
  height: number;
  uploadId?: string | null;
}) {
  const { sessionId, file, width, height, uploadId } = params;
  const database = await getDatabase();
  await ensureStorageStructure(sessionId);

  const id = uploadId || crypto.randomUUID();
  const timestamp = nowIso();
  const extension = getExtension(file.name, file.type);
  const safeName = sanitizeFileStem(file.name);
  const storedName = `${safeName}-${id}.${extension}`;
  const filePath = resolveUploadPath(sessionId, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (uploadId) {
    const existing = database
      .prepare("SELECT file_path FROM uploads WHERE id = ? AND session_id = ?")
      .get(uploadId, sessionId) as { file_path: string } | undefined;

    if (!existing) {
      throw new Error("Upload nao encontrado para atualizacao.");
    }

    await deleteResultByUpload(sessionId, uploadId);
    await deleteFileIfExists(existing.file_path);

    database
      .prepare(
        `UPDATE uploads
         SET original_name = ?, mime_type = ?, file_size = ?, width = ?, height = ?, stored_name = ?, file_path = ?,
             generation_status = 'uploaded', error_message = NULL, updated_at = ?
         WHERE id = ? AND session_id = ?`,
      )
      .run(
        file.name,
        file.type || "image/jpeg",
        buffer.byteLength,
        width,
        height,
        storedName,
        filePath,
        timestamp,
        uploadId,
        sessionId,
      );
  } else {
    database
      .prepare(
        `INSERT INTO uploads (
           id, session_id, original_name, mime_type, file_size, width, height, stored_name, file_path,
           generation_status, error_message, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', NULL, ?, ?)`,
      )
      .run(
        id,
        sessionId,
        file.name,
        file.type || "image/jpeg",
        buffer.byteLength,
        width,
        height,
        storedName,
        filePath,
        timestamp,
        timestamp,
      );
  }

  await fs.writeFile(filePath, buffer);

  const upload = database
    .prepare(
      `SELECT id, original_name, file_size, width, height, generation_status, error_message, created_at
       FROM uploads
       WHERE id = ?`,
    )
    .get(id) as UploadRow;

  return buildUploadRecord(upload);
}

export async function deleteUpload(sessionId: string, uploadId: string) {
  const database = await getDatabase();
  const upload = database
    .prepare("SELECT file_path FROM uploads WHERE id = ? AND session_id = ?")
    .get(uploadId, sessionId) as { file_path: string } | undefined;

  if (!upload) {
    return false;
  }

  await deleteResultByUpload(sessionId, uploadId);
  await deleteFileIfExists(upload.file_path);

  database
    .prepare("DELETE FROM uploads WHERE id = ? AND session_id = ?")
    .run(uploadId, sessionId);

  return true;
}

export async function getUploadFile(sessionId: string, uploadId: string) {
  const database = await getDatabase();
  return database
    .prepare(
      "SELECT file_path AS filePath, mime_type AS mimeType, original_name AS fileName FROM uploads WHERE id = ? AND session_id = ?",
    )
    .get(uploadId, sessionId) as
    | { filePath: string; mimeType: string; fileName: string }
    | undefined;
}

export async function getResultFile(sessionId: string, resultId: string) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  return database
    .prepare(
      `SELECT file_path AS filePath, mime_type AS mimeType, file_name AS fileName
       FROM results
       WHERE id = ? AND session_id = ? AND id NOT IN (SELECT result_id FROM result_cost_log)`,
    )
    .get(resultId, sessionId) as
    | { filePath: string; mimeType: string; fileName: string }
    | undefined;
}

export async function getAdminResultFile(resultId: string) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  return database
    .prepare(
      `SELECT file_path AS filePath, mime_type AS mimeType, file_name AS fileName
       FROM results
       WHERE id = ? AND id NOT IN (SELECT result_id FROM result_cost_log)`,
    )
    .get(resultId) as
    | { filePath: string; mimeType: string; fileName: string }
    | undefined;
}

export async function getAdminUploadFile(uploadId: string) {
  const database = await getDatabase();
  return database
    .prepare(
      "SELECT file_path AS filePath, mime_type AS mimeType, original_name AS fileName FROM uploads WHERE id = ?",
    )
    .get(uploadId) as
    | { filePath: string; mimeType: string; fileName: string }
    | undefined;
}

export async function markUploadProcessing(sessionId: string, uploadId: string) {
  const database = await getDatabase();
  database
    .prepare(
      "UPDATE uploads SET generation_status = 'processing', error_message = NULL, updated_at = ? WHERE id = ? AND session_id = ?",
    )
    .run(nowIso(), uploadId, sessionId);
}

export async function markUploadError(sessionId: string, uploadId: string, message: string) {
  const database = await getDatabase();
  database
    .prepare(
      "UPDATE uploads SET generation_status = 'error', error_message = ?, updated_at = ? WHERE id = ? AND session_id = ?",
    )
    .run(message, nowIso(), uploadId, sessionId);
}

export async function getUploadForGeneration(sessionId: string, uploadId: string) {
  const database = await getDatabase();
  return database
    .prepare(
      `SELECT id, original_name AS fileName, mime_type AS mimeType, file_path AS filePath
       FROM uploads
       WHERE id = ? AND session_id = ?`,
    )
    .get(uploadId, sessionId) as
    | { id: string; fileName: string; mimeType: string; filePath: string }
    | undefined;
}

export async function saveGenerationResult(params: {
  sessionId: string;
  uploadId: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  requestId: string | null;
  usageJson?: string | null;
  settingsJson?: string | null;
  estimatedCostUsd?: number | null;
}) {
  const {
    sessionId,
    uploadId,
    buffer,
    fileName,
    mimeType,
    requestId,
    usageJson = null,
    settingsJson = null,
    estimatedCostUsd = null,
  } = params;
  const database = await getDatabase();
  await ensureStorageStructure(sessionId);
  await deleteResultByUpload(sessionId, uploadId);

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const extension = getExtension(fileName, mimeType);
  const storedName = `${sanitizeFileStem(fileName)}-${id}.${extension}`;
  const filePath = resolveResultPath(sessionId, storedName);

  await fs.writeFile(filePath, buffer);

  database
    .prepare(
      `INSERT INTO results (
         id, session_id, upload_id, file_name, mime_type, stored_name, file_path,
         review_status, request_id, usage_json, settings_json, estimated_cost_usd, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      sessionId,
      uploadId,
      fileName,
      mimeType,
      storedName,
      filePath,
      requestId,
      usageJson,
      settingsJson,
      estimatedCostUsd,
      timestamp,
      timestamp,
    );

  database
    .prepare(
      "UPDATE uploads SET generation_status = 'generated', error_message = NULL, updated_at = ? WHERE id = ? AND session_id = ?",
    )
    .run(timestamp, uploadId, sessionId);

  const result = database
    .prepare(
      `SELECT id, upload_id, file_name, review_status, request_id, estimated_cost_usd, created_at
       FROM results
       WHERE id = ?`,
    )
    .get(id) as ResultRow;

  return buildResultRecord(result);
}

export async function deleteResultByUpload(sessionId: string, uploadId: string) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const existing = database
    .prepare(
      `SELECT id, session_id, upload_id, file_name, file_path, request_id, usage_json, settings_json, estimated_cost_usd, created_at
       FROM results
       WHERE session_id = ? AND upload_id = ?`,
    )
    .get(sessionId, uploadId) as
    | {
        id: string;
        session_id: string;
        upload_id: string;
        file_name: string;
        file_path: string;
        request_id: string | null;
        usage_json: string | null;
        settings_json: string | null;
        estimated_cost_usd: number | null;
        created_at: string;
      }
    | undefined;

  if (!existing) {
    return;
  }

  await archiveResultCostLog(existing);
  await deleteFileIfExists(existing.file_path);
  database
    .prepare("DELETE FROM results WHERE id = ?")
    .run(existing.id);
}

export async function updateResultSelection(params: {
  sessionId: string;
  keepIds: string[];
  rejectIds: string[];
  deleteIds: string[];
}) {
  const { sessionId, keepIds, rejectIds, deleteIds } = params;
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const timestamp = nowIso();

  if (keepIds.length) {
    const placeholders = keepIds.map(() => "?").join(", ");
    database
      .prepare(
        `UPDATE results
         SET review_status = 'kept', updated_at = ?
         WHERE session_id = ? AND id IN (${placeholders})`,
      )
      .run(timestamp, sessionId, ...keepIds);
  }

  if (rejectIds.length) {
    const placeholders = rejectIds.map(() => "?").join(", ");
    database
      .prepare(
        `UPDATE results
         SET review_status = 'rejected', updated_at = ?
         WHERE session_id = ? AND id IN (${placeholders})`,
      )
      .run(timestamp, sessionId, ...rejectIds);
  }

  for (const resultId of deleteIds) {
    const row = database
      .prepare(
        `SELECT id, session_id, upload_id, file_name, file_path, request_id, usage_json, settings_json,
                estimated_cost_usd, created_at
         FROM results
         WHERE id = ? AND session_id = ?`,
      )
      .get(resultId, sessionId) as
      | {
          id: string;
          session_id: string;
          upload_id: string;
          file_name: string;
          file_path: string;
          request_id: string | null;
          usage_json: string | null;
          settings_json: string | null;
          estimated_cost_usd: number | null;
          created_at: string;
        }
      | undefined;

    if (!row) {
      continue;
    }

    await archiveResultCostLog(row);
    await deleteFileIfExists(row.file_path);
    database.prepare("DELETE FROM results WHERE id = ?").run(row.id);
    database
      .prepare(
        "UPDATE uploads SET generation_status = 'uploaded', error_message = NULL, updated_at = ? WHERE id = ? AND session_id = ?",
      )
      .run(timestamp, row.upload_id, sessionId);
  }
}

export async function updateAdminResultReviewStatus(
  resultId: string,
  reviewStatus: ResultRecord["reviewStatus"],
) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const row = database
    .prepare("SELECT id FROM results WHERE id = ?")
    .get(resultId) as { id: string } | undefined;

  if (!row) {
    return false;
  }

  database
    .prepare("UPDATE results SET review_status = ?, updated_at = ? WHERE id = ?")
    .run(reviewStatus, timestamp, resultId);

  return true;
}

export async function updateAdminResultCost(resultId: string, estimatedCostUsd: number) {
  const database = await getDatabase();
  const timestamp = nowIso();
  const row = database
    .prepare("SELECT id FROM results WHERE id = ?")
    .get(resultId) as { id: string } | undefined;

  if (!row) {
    return false;
  }

  database
    .prepare("UPDATE results SET estimated_cost_usd = ?, updated_at = ? WHERE id = ?")
    .run(estimatedCostUsd, timestamp, resultId);

  return true;
}

export async function deleteAdminResult(resultId: string) {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const timestamp = nowIso();
  const row = database
    .prepare(
      `SELECT id, session_id, upload_id, file_name, file_path, request_id, usage_json, settings_json,
              estimated_cost_usd, created_at
       FROM results
       WHERE id = ?`,
    )
    .get(resultId) as
    | {
        id: string;
        session_id: string;
        upload_id: string;
        file_name: string;
        file_path: string;
        request_id: string | null;
        usage_json: string | null;
        settings_json: string | null;
        estimated_cost_usd: number | null;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return false;
  }

  await archiveResultCostLog(row);
  await deleteFileIfExists(row.file_path);
  database.prepare("DELETE FROM results WHERE id = ?").run(row.id);
  database
    .prepare(
      "UPDATE uploads SET generation_status = 'uploaded', error_message = NULL, updated_at = ? WHERE id = ? AND session_id = ?",
    )
    .run(timestamp, row.upload_id, row.session_id);

  return true;
}

export async function listCollectionSessions() {
  const database = await getDatabase();
  return database
    .prepare(
      `SELECT
         sessions.id,
         sessions.created_at,
         sessions.updated_at,
         COUNT(DISTINCT uploads.id) AS upload_count,
         COUNT(DISTINCT results.id) AS result_count,
         COUNT(DISTINCT CASE WHEN results.review_status = 'kept' THEN results.id END) AS kept_count
       FROM sessions
       LEFT JOIN uploads ON uploads.session_id = sessions.id
       LEFT JOIN results ON results.session_id = sessions.id
       GROUP BY sessions.id
       ORDER BY sessions.updated_at DESC`,
    )
    .all() as CollectionSessionRow[];
}

export async function listAdminGallery() {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const rows = database
    .prepare(
      `SELECT
         results.id,
         results.session_id,
         results.upload_id,
         results.file_name,
         results.review_status,
         results.request_id,
         results.estimated_cost_usd,
         results.usage_json,
         results.settings_json,
         results.created_at,
         uploads.original_name
       FROM results
       INNER JOIN uploads ON uploads.id = results.upload_id
       WHERE results.id NOT IN (SELECT result_id FROM result_cost_log)
       ORDER BY results.created_at DESC`,
    )
    .all() as AdminResultRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    uploadId: row.upload_id,
    fileName: row.file_name,
    imageUrl: `/api/admin/files/result/${row.id}`,
    reviewStatus: row.review_status,
    requestId: row.request_id,
    createdAt: row.created_at,
    originalName: row.original_name,
    uploadImageUrl: `/api/admin/files/upload/${row.upload_id}`,
    estimatedCostUsd: row.estimated_cost_usd,
    usage: parseJson<ImageUsage>(row.usage_json),
    settings: parseJson<GenerationSettings>(row.settings_json),
  })) as AdminGalleryItem[];
}

export async function getAdminUsageSummary() {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const rows = database
    .prepare(
      `SELECT review_status, usage_json, estimated_cost_usd
       FROM results
       WHERE id NOT IN (SELECT result_id FROM result_cost_log)
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
    review_status: ResultRecord["reviewStatus"];
    usage_json: string | null;
    estimated_cost_usd: number | null;
  }>;

  let resultCount = 0;
  let keptCount = 0;
  let rejectedCount = 0;
  let trackedCount = 0;
  let exactSpentUsd = 0;
  let totalInputTextTokens = 0;
  let totalInputImageTokens = 0;
  let totalOutputTextTokens = 0;
  let usageCount = 0;

  for (const row of rows) {
    resultCount += 1;

    if (row.review_status === "kept") {
      keptCount += 1;
    } else if (row.review_status === "rejected") {
      rejectedCount += 1;
    }

    if (typeof row.estimated_cost_usd === "number") {
      trackedCount += 1;
      exactSpentUsd += row.estimated_cost_usd;
    }

    const usage = parseJson<ImageUsage>(row.usage_json);

    if (!usage) {
      continue;
    }

    totalInputTextTokens += usage.input_tokens_details?.text_tokens || 0;
    totalInputImageTokens += usage.input_tokens_details?.image_tokens || 0;
    totalOutputTextTokens += usage.output_tokens_details?.text_tokens || 0;
    usageCount += 1;
  }

  const archivedRows = database
    .prepare(
      `SELECT usage_json, estimated_cost_usd
       FROM result_cost_log
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
      usage_json: string | null;
      estimated_cost_usd: number | null;
    }>;

  for (const row of archivedRows) {
    if (typeof row.estimated_cost_usd === "number") {
      exactSpentUsd += row.estimated_cost_usd;
    }

    const usage = parseJson<ImageUsage>(row.usage_json);

    if (!usage) {
      continue;
    }

    totalInputTextTokens += usage.input_tokens_details?.text_tokens || 0;
    totalInputImageTokens += usage.input_tokens_details?.image_tokens || 0;
    totalOutputTextTokens += usage.output_tokens_details?.text_tokens || 0;
    usageCount += 1;
  }

  return {
    resultCount,
    keptCount,
    rejectedCount,
    trackedCount,
    legacyCount: Math.max(0, resultCount - trackedCount),
    exactSpentUsd,
    averageInputTextTokens: usageCount ? totalInputTextTokens / usageCount : 0,
    averageInputImageTokens: usageCount ? totalInputImageTokens / usageCount : 0,
    averageOutputTextTokens: usageCount ? totalOutputTextTokens / usageCount : 0,
  } satisfies AdminUsageSummary;
}

export async function listAdminCostLedger() {
  const database = await getDatabase();
  ensureRepositorySchema(database);
  const rows = database
    .prepare(
      `SELECT * FROM (
         SELECT
           results.id AS id,
           results.id AS result_id,
           results.file_name,
           uploads.original_name,
           results.estimated_cost_usd,
           results.request_id,
           results.created_at,
           NULL AS deleted_at,
           results.settings_json,
           'active' AS status
         FROM results
         LEFT JOIN uploads ON uploads.id = results.upload_id
         WHERE results.estimated_cost_usd IS NOT NULL

         UNION ALL

         SELECT
           result_cost_log.id AS id,
           result_cost_log.result_id,
           result_cost_log.file_name,
           uploads.original_name,
           result_cost_log.estimated_cost_usd,
           result_cost_log.request_id,
           result_cost_log.created_at,
           result_cost_log.deleted_at,
           result_cost_log.settings_json,
           'deleted' AS status
         FROM result_cost_log
         LEFT JOIN uploads ON uploads.id = result_cost_log.upload_id
         WHERE result_cost_log.estimated_cost_usd IS NOT NULL
       )
       ORDER BY created_at DESC, deleted_at DESC`,
    )
    .all() as AdminCostLedgerRow[];

  return rows.map((row) => ({
    id: row.id,
    resultId: row.result_id,
    fileName: row.file_name,
    originalName: row.original_name,
    estimatedCostUsd: row.estimated_cost_usd,
    requestId: row.request_id,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    settings: parseJson<GenerationSettings>(row.settings_json),
    status: row.status,
  })) as AdminCostLedgerItem[];
}

export async function buildCollectionZip(sessionId?: string) {
  const database = await getDatabase();
  const zip = new JSZip();
  const params = sessionId ? [sessionId] : [];
  const sessions = database
    .prepare(
      `SELECT id, created_at, updated_at
       FROM sessions
       ${sessionId ? "WHERE id = ?" : ""}
       ORDER BY updated_at DESC`,
    )
    .all(...params) as CollectionArchiveSessionRow[];
  const uploads = database
    .prepare(
      `SELECT
         session_id,
         id AS upload_id,
         original_name,
         file_path,
         mime_type,
         file_size,
         width,
         height,
         generation_status,
         error_message,
         created_at,
         updated_at
       FROM uploads
       ${sessionId ? "WHERE session_id = ?" : ""}
       ORDER BY created_at DESC`,
    )
    .all(...params) as CollectionUploadRow[];
  const results = database
    .prepare(
      `SELECT
         session_id,
         id AS result_id,
         upload_id,
         file_name,
         file_path,
         mime_type,
         review_status,
         request_id,
         usage_json,
         settings_json,
         estimated_cost_usd,
         created_at,
         updated_at
       FROM results
       ${sessionId ? "WHERE session_id = ?" : ""}
       ORDER BY created_at DESC`,
    )
    .all(...params) as CollectionResultRow[];

  for (const session of sessions) {
    zip.folder(session.id);
  }

  for (const upload of uploads) {
    const folder = zip.folder(upload.session_id);

    if (!folder) {
      continue;
    }

    const archiveName = buildArchiveFileName(
      upload.upload_id,
      upload.original_name,
      upload.mime_type,
    );
    const buffer = await fs.readFile(upload.file_path);
    folder.file(`uploads/${archiveName}`, buffer);
  }

  for (const result of results) {
    const folder = zip.folder(result.session_id);

    if (!folder) {
      continue;
    }

    const archiveName = buildArchiveFileName(
      result.result_id,
      result.file_name,
      result.mime_type,
    );
    const buffer = await fs.readFile(result.file_path);
    folder.file(`resultados/${result.review_status}/${archiveName}`, buffer);
  }

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        exportedAt: nowIso(),
        scope: sessionId ? "session" : "all",
        sessionId: sessionId || null,
        sessions: sessions.map((session) => ({
          sessionId: session.id,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        })),
        uploads: uploads.map((upload) => ({
          sessionId: upload.session_id,
          uploadId: upload.upload_id,
          originalName: upload.original_name,
          storedAs: `uploads/${buildArchiveFileName(
            upload.upload_id,
            upload.original_name,
            upload.mime_type,
          )}`,
          mimeType: upload.mime_type,
          fileSize: upload.file_size,
          width: upload.width,
          height: upload.height,
          generationStatus: upload.generation_status,
          errorMessage: upload.error_message,
          createdAt: upload.created_at,
          updatedAt: upload.updated_at,
        })),
        results: results.map((result) => ({
          sessionId: result.session_id,
          resultId: result.result_id,
          uploadId: result.upload_id,
          fileName: result.file_name,
          storedAs: `resultados/${result.review_status}/${buildArchiveFileName(
            result.result_id,
            result.file_name,
            result.mime_type,
          )}`,
          mimeType: result.mime_type,
          reviewStatus: result.review_status,
          requestId: result.request_id,
          usage: parseJson<ImageUsage>(result.usage_json),
          settings: parseJson<GenerationSettings>(result.settings_json),
          estimatedCostUsd: result.estimated_cost_usd,
          createdAt: result.created_at,
          updatedAt: result.updated_at,
        })),
      },
      null,
      2,
    ),
  );

  return zip.generateAsync({ type: "nodebuffer" });
}
