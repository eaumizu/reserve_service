// Workers does not implement redirect:"error". Request redirects manually so
// credentials are never forwarded, then reject every redirect explicitly.
export async function fetchWithoutRedirect(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await fetch(input, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    try { await response.body?.cancel(); } catch {}
    throw new Error("unexpected_http_redirect");
  }
  return response;
}
