import { listCollectionSessions } from "@/lib/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  return Boolean(process.env.ADMIN_ACCESS_TOKEN) && token === process.env.ADMIN_ACCESS_TOKEN;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const sessions = await listCollectionSessions();

  return Response.json({ sessions });
}
