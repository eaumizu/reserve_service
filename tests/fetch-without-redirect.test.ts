import { afterEach, expect, it, vi } from "vitest";
import { fetchWithoutRedirect } from "../lib/fetch-without-redirect";
afterEach(() => vi.unstubAllGlobals());
it("preserves authenticated POST data and signal while using Workers-compatible redirect handling", async () => {
  const response = Response.json({ ok: true }), fetch = vi.fn(async () => response), signal = AbortSignal.timeout(1000);
  vi.stubGlobal("fetch", fetch);
  const headers = { Authorization: "Bearer test-only" }, body = new URLSearchParams({ grant_type: "refresh_token" });
  expect(await fetchWithoutRedirect("https://provider.example/token", { method: "POST", headers, body, signal, redirect: "follow" })).toBe(response);
  expect(fetch).toHaveBeenCalledExactlyOnceWith("https://provider.example/token", { method: "POST", headers, body, signal, redirect: "manual" });
});
it.each([301,302,303,307,308])("rejects HTTP %s without forwarding credentials to Location", async status => {
  const cancel = vi.fn(), stream = new ReadableStream({ cancel });
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(stream, { status, headers: { Location: "https://untrusted.example/secret" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchWithoutRedirect("https://provider.example/token", { headers: { Authorization: "Bearer test-only" } })).rejects.toThrow("unexpected_http_redirect");
  expect(fetch).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe("https://provider.example/token");
});
it("preserves non-redirect HTTP errors for provider-specific handling", async () => {
  const response = Response.json({ error: "invalid_client" }, { status: 401 });
  vi.stubGlobal("fetch", vi.fn(async () => response));
  expect(await fetchWithoutRedirect("https://provider.example/token")).toBe(response);
});
