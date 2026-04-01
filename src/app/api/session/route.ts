import { ensureServerSession, touchSession } from "@/lib/server/session";
import { getSessionState } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sessionId = await ensureServerSession();
  await touchSession(sessionId);
  const state = await getSessionState(sessionId);

  return Response.json({
    sessionId,
    ...state,
  });
}
