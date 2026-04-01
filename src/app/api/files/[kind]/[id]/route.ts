import { promises as fs } from "node:fs";
import { ensureServerSession } from "@/lib/server/session";
import { getResultFile, getUploadFile } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const sessionId = await ensureServerSession();
  const { kind, id } = await context.params;

  const file =
    kind === "upload"
      ? await getUploadFile(sessionId, id)
      : kind === "result"
        ? await getResultFile(sessionId, id)
        : undefined;

  if (!file) {
    return new Response("Not found", { status: 404 });
  }

  const buffer = await fs.readFile(file.filePath);

  return new Response(buffer, {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${file.fileName}"`,
    },
  });
}
