import "server-only";

import path from "node:path";
import { promises as fs } from "node:fs";

const PRODUCTION_DATA_ROOT = "/data";
const DEVELOPMENT_DATA_ROOT = path.join(process.cwd(), ".data");

export function getDataRoot() {
  return process.env.DATA_ROOT ||
    (process.env.NODE_ENV === "production" ? PRODUCTION_DATA_ROOT : DEVELOPMENT_DATA_ROOT);
}

export function getDatabasePath() {
  return path.join(getDataRoot(), "bb-camisa.sqlite");
}

export function getSessionRoot(sessionId: string) {
  return path.join(getDataRoot(), "sessions", sessionId);
}

export function getUploadRoot(sessionId: string) {
  return path.join(getSessionRoot(sessionId), "uploads");
}

export function getResultRoot(sessionId: string) {
  return path.join(getSessionRoot(sessionId), "results");
}

export async function ensureStorageStructure(sessionId?: string) {
  const targets = [getDataRoot()];

  if (sessionId) {
    targets.push(getSessionRoot(sessionId), getUploadRoot(sessionId), getResultRoot(sessionId));
  }

  await Promise.all(
    targets.map((target) =>
      fs.mkdir(target, {
        recursive: true,
      }),
    ),
  );
}

export function resolveUploadPath(sessionId: string, storedName: string) {
  return path.join(getUploadRoot(sessionId), storedName);
}

export function resolveResultPath(sessionId: string, storedName: string) {
  return path.join(getResultRoot(sessionId), storedName);
}
