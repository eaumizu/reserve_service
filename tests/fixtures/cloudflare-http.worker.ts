// Test-only: native workerd Request validation, real application/SDK code and
// synthetic provider responses. No external network, credentials or DB writes.
import { adminAvailableStarts } from "../../lib/reservations/admin-availability";
import { encryptCalendarSecret } from "../../lib/google-calendar";
import { fetchWithoutRedirect } from "../../lib/fetch-without-redirect";
import { resendFetch } from "../../lib/resend-request";
const storeId = "11111111-1111-1111-1111-111111111111";
const serviceId = "44444444-4444-4444-4444-444444444444";
const staffId = "22222222-2222-2222-2222-222222222222";
const worker = {
  async fetch() {
    const originalFetch = globalThis.fetch;
    const requests: { host: string; mode: string; method: string }[] = [];
    globalThis.fetch = async (input, init) => {
      // This native constructor rejects redirect:"error" in workerd before any
      // request can be sent. Node-only mocks did not catch that incompatibility.
      const request = new Request(input, init), url = new URL(request.url);
      requests.push({ host: url.hostname, mode: request.redirect, method: request.method });
      if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "test-access" });
      if (url.hostname === "www.googleapis.com") return Response.json({ items: [{ start: { dateTime: "2030-01-02T10:00:00+09:00" }, end: { dateTime: "2030-01-02T11:00:00+09:00" } }] });
      if (url.hostname === "api.resend.com" || url.hostname === "api.line.me") return Response.json({ ok: true });
      if (url.hostname === "redirect.test") return new Response(null, { status: 302, headers: { Location: "https://untrusted.example/credential-leak" } });
      if (url.hostname !== "example.supabase.co") throw new Error("unexpected_test_destination");
      const path = url.pathname;
      if (path.endsWith("/rpc/store_calendar_credentials")) return Response.json({ busyEnabled: true, revision: "test-revision", calendarId: "test-calendar", refreshCipher: encryptCalendarSecret(storeId, "test-refresh") });
      if (path.endsWith("/rpc/begin_store_calendar_busy")) return Response.json("test-ticket");
      if (path.endsWith("/rpc/save_store_calendar_busy")) return Response.json(true);
      if (path.endsWith("/services")) return Response.json([{ id: serviceId, duration_minutes: 60, buffer_before: 0, buffer_after: 0 }]);
      if (path.endsWith("/staff_services")) return Response.json([{ staff_id: staffId, staff: { store_id: storeId, active: true } }]);
      if (path.endsWith("/business_hours")) return Response.json([{ start_time: "09:00:00", end_time: "12:00:00" }]);
      if (path.endsWith("/reservations") || path.endsWith("/availability_blocks")) return Response.json([]);
      throw new Error("unexpected_test_path");
    };
    try {
      const slots = await adminAvailableStarts(storeId, serviceId, staffId, "2030-01-02");
      const mail = await resendFetch("https://api.resend.com/domains/test", {});
      const line = await fetchWithoutRedirect("https://api.line.me/v2/bot/info", { headers: { Authorization: "Bearer test-only" } });
      let redirectRejected = false;
      try { await fetchWithoutRedirect("https://redirect.test/token", { headers: { Authorization: "Bearer test-only" } }); } catch { redirectRejected = true; }
      return Response.json({ slots, mailOK: mail.ok, lineOK: line.ok, redirectRejected, requests });
    } finally { globalThis.fetch = originalFetch; }
  },
};
export default worker;
