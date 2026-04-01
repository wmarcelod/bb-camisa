import "server-only";

export function isAdminToken(token: string | null | undefined) {
  return Boolean(process.env.ADMIN_ACCESS_TOKEN) && token === process.env.ADMIN_ACCESS_TOKEN;
}

export function getAdminTokenFromUrl(url: string) {
  return new URL(url).searchParams.get("token");
}

export function isAuthorizedAdminRequest(request: Request) {
  return isAdminToken(getAdminTokenFromUrl(request.url));
}
