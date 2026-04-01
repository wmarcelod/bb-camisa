import { buildCollectionZip } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return Boolean(process.env.ADMIN_ACCESS_TOKEN) && token === process.env.ADMIN_ACCESS_TOKEN;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId") || undefined;
  const archive = await buildCollectionZip(sessionId);
  const fileName = sessionId
    ? `bb-camisa-${sessionId}.zip`
    : "bb-camisa-coleta.zip";

  return new Response(new Uint8Array(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
