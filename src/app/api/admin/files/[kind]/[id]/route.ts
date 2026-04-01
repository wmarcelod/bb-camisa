import { promises as fs } from "node:fs";
import { isAuthorizedAdminRequest } from "@/lib/server/admin";
import { getAdminResultFile, getAdminUploadFile } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  if (!isAuthorizedAdminRequest(request)) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  const { kind, id } = await context.params;
  const file =
    kind === "upload"
      ? await getAdminUploadFile(id)
      : kind === "result"
        ? await getAdminResultFile(id)
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
