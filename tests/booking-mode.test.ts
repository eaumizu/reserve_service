import { beforeEach, expect, it, vi } from "vitest";
const { from, query } = vi.hoisted(() => ({ from: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock("../lib/supabase-server", () => ({ supabaseServer: () => ({ from }) }));
import { readBookingMode } from "../lib/booking-mode-server";
import { GET } from "../app/api/booking-mode/route";
import { parseSettingsChange } from "../lib/store-settings";
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_DEFAULT_STORE_ID", "configured-store");
  from.mockReturnValue(query); query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { booking_mode: "date" }, error: null });
});
it("returns only the configured public mode and uses a scoped uncached read", async () => {
  const response = await GET(); expect(await response.json()).toEqual({ mode: "date" });
  expect(from).toHaveBeenCalledWith("store_booking_preferences"); expect(query.eq).toHaveBeenCalledWith("store_id", "configured-store");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("defaults an unconfigured store to menu mode", async () => {
  query.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(await readBookingMode("store")).toEqual({ mode: "menu", ready: true });
});
it.each(["42P01", "PGRST205"])("keeps existing bookings usable before the additive migration (%s)", async code => {
  query.maybeSingle.mockResolvedValue({ data: null, error: { code } });
  expect(await readBookingMode("store")).toEqual({ mode: "menu", ready: false });
});
it.each(["42501", "08006", "PGRST301"])("does not silently replace the configured page on failure (%s)", async code => {
  query.maybeSingle.mockResolvedValue({ data: null, error: { code, message: "private detail" } });
  const r = await GET(); expect(r.status).toBe(503); expect(await r.text()).not.toContain("private detail");
});
it("fails closed on corrupt configuration", async () => {
  query.maybeSingle.mockResolvedValue({ data: { booking_mode: "both" }, error: null });
  expect((await GET()).status).toBe(503);
});
it("whitelists both valid modes, discards store overrides and rejects invalid modes", () => {
  for (const mode of ["menu", "date"]) expect(parseSettingsChange({ kind: "booking_mode", storeId: "other", data: { mode, store_id: "other" } })).toEqual({ kind: "booking_mode", data: { mode } });
  for (const mode of ["both", "", null, 1, {}, undefined]) expect(parseSettingsChange({ kind: "booking_mode", data: { mode } })).toBeNull();
});
