import "server-only";

import { DatabaseSync } from "node:sqlite";
import { ensureStorageStructure, getDatabasePath } from "@/lib/server/storage";

declare global {
  var __bbCamisaDb: DatabaseSync | undefined;
}

function initializeDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      generation_status TEXT NOT NULL DEFAULT 'uploaded',
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      upload_id TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending',
      request_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (upload_id) REFERENCES uploads(id)
    );
  `);
}

export async function getDatabase() {
  if (!globalThis.__bbCamisaDb) {
    await ensureStorageStructure();
    const database = new DatabaseSync(getDatabasePath());
    initializeDatabase(database);
    globalThis.__bbCamisaDb = database;
  }

  return globalThis.__bbCamisaDb;
}
