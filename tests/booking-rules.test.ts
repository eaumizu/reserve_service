import { describe, expect, it } from "vitest";
import { acceptsWebBooking, bookingDateBounds, validBookingRules } from "../lib/booking-rules";
import { parseSettingsChange } from "../lib/store-settings";
const rules = { advance_days: 30, cutoff_minutes: 60 };
const now = Date.parse("2030-01-01T10:00:00+09:00");
describe("booking reception rules", () => {
  it("includes the exact cutoff but excludes expired starts", () => {
    expect(acceptsWebBooking("2030-01-01T11:00:00+09:00", rules, now)).toBe(true);
    expect(acceptsWebBooking("2030-01-01T10:59:59+09:00", rules, now)).toBe(false);
    expect(acceptsWebBooking("2030-01-01T10:00:00+09:00", { ...rules, cutoff_minutes: 0 }, now)).toBe(false);
    expect(acceptsWebBooking("2030-01-01T10:00:01+09:00", { ...rules, cutoff_minutes: 0 }, now)).toBe(true);
  });
  it("includes the entire last Japan day, crossing month and year boundaries", () => {
    expect(acceptsWebBooking("2030-01-31T23:45:00+09:00", rules, now)).toBe(true);
    expect(acceptsWebBooking("2030-02-01T00:00:00+09:00", rules, now)).toBe(false);
    expect(bookingDateBounds({ ...rules, advance_days: 1 }, Date.parse("2029-12-31T15:00:00Z"))).toEqual({ minDate: "2030-01-01", maxDate: "2030-01-02" });
  });
  it("supports today only and rejects invalid timestamps", () => {
    expect(acceptsWebBooking("2030-01-01T12:00:00+09:00", { ...rules, advance_days: 0 }, now)).toBe(true);
    expect(acceptsWebBooking("2030-01-02T12:00:00+09:00", { ...rules, advance_days: 0 }, now)).toBe(false);
    expect(acceptsWebBooking("invalid", rules, now)).toBe(false);
  });
  it.each([{ advance_days: -1, cutoff_minutes: 60 }, { advance_days: 366, cutoff_minutes: 60 }, { advance_days: 30, cutoff_minutes: 10 }, { advance_days: 30.5, cutoff_minutes: 60 }, { advance_days: 30, cutoff_minutes: 1455 }])("rejects invalid settings %j", value => {
    expect(validBookingRules(value)).toBe(false);
    expect(parseSettingsChange({ kind: "booking_rules", data: value })).toBeNull();
  });
  it("whitelists rule edits without accepting another store", () => {
    expect(parseSettingsChange({ kind: "booking_rules", data: { ...rules, store_id: "other" } })).toEqual({ kind: "booking_rules", data: rules });
  });
});
