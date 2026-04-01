import "server-only";

import { cookies } from "next/headers";
import { getDatabase } from "@/lib/server/database";

export const SESSION_COOKIE_NAME = "bb_camisa_session";

function nowIso() {
  return new Date().toISOString();
}

export async function ensureServerSession() {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const database = await getDatabase();
  const timestamp = nowIso();
  const existing = database
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(sessionId) as { id: string } | undefined;

  if (existing) {
    database
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(timestamp, sessionId);
  } else {
    database
      .prepare("INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)")
      .run(sessionId, timestamp, timestamp);
  }

  return sessionId;
}

export async function touchSession(sessionId: string) {
  const database = await getDatabase();
  database
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(nowIso(), sessionId);
}
