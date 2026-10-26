import { describe, expect, it, vi } from "vitest";
import worker, { runScheduledReminders } from "../cloudflare/reminders.worker";

describe("Cloudflare reminder trigger", () => {
  const secret = "s".repeat(32);
  it("cannot send until explicitly enabled", async () => {
    const fetch = vi.fn();
    await runScheduledReminders({ BOOKING_APP: { fetch }, CRON_SECRET: secret });
    await runScheduledReminders({ BOOKING_APP: { fetch }, CRON_SECRET: secret, REMINDERS_ENABLED: "false" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails before dispatch when the shared secret is missing", async () => {
    const fetch = vi.fn();
    await expect(runScheduledReminders({ BOOKING_APP: { fetch }, REMINDERS_ENABLED: "true" })).rejects.toThrow("secret_missing");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("authenticates exactly one call through the production service binding", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/cron/reminders");
      expect(request.method).toBe("GET");
      expect(request.headers.get("Authorization")).toBe(`Bearer ${secret}`);
      expect(request.redirect).toBe("manual");
      return Response.json({ sent: 2, failed: 0 });
    });
    await worker.scheduled({}, { BOOKING_APP: { fetch }, CRON_SECRET: secret, REMINDERS_ENABLED: "true" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [new Response("denied", { status: 401 }), "http_401"],
    [new Response(null, { status: 302, headers: { Location: "https://untrusted.example" } }), "http_302"],
    [Response.json({ sent: 1, failed: 1 }), "delivery_failed"],
    [Response.json({ ok: true }), "invalid_response"],
  ])("reports failed dispatches for operations", async (response, message) => {
    await expect(runScheduledReminders({ BOOKING_APP: { fetch: async () => response }, CRON_SECRET: secret, REMINDERS_ENABLED: "true" })).rejects.toThrow(message);
  });
  it("exposes no public notification trigger", async () => {
    expect((await worker.fetch()).status).toBe(404);
  });
});
