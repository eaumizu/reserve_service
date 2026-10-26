// Kept separate from the Next.js worker so a web deployment cannot enable cron.
export type ReminderEnvironment = {
  BOOKING_APP: { fetch(request: Request): Promise<Response> };
  CRON_SECRET?: string;
  REMINDERS_ENABLED?: string;
};

export async function runScheduledReminders(env: ReminderEnvironment) {
  if (env.REMINDERS_ENABLED !== "true") return;
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    throw new Error("reminder_cron_secret_missing");
  }
  // Service binding addresses the deployed app directly, without public DNS.
  const response = await env.BOOKING_APP.fetch(new Request("https://booking.internal/api/cron/reminders", {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    redirect: "error",
  }));
  if (!response.ok) throw new Error(`reminder_dispatch_http_${response.status}`);
  const result = await response.json() as { sent?: number; failed?: number };
  if (!Number.isInteger(result.sent) || !Number.isInteger(result.failed)) {
    throw new Error("reminder_dispatch_invalid_response");
  }
  if (result.failed! > 0) throw new Error("reminder_dispatch_delivery_failed");
}

const worker = {
  async scheduled(_event: unknown, env: ReminderEnvironment) {
    await runScheduledReminders(env);
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
export default worker;
