import { describe, expect, it } from "vitest";
import { parseSettingsChange } from "../lib/store-settings";
const service = { name: "整体", duration_minutes: 60, buffer_before: 0, buffer_after: 15, price: 6000, active: true, online_bookable: true };
describe("store setting validation", () => {
  it("allows quarter-hour opening and closing", () => {
    expect(parseSettingsChange({ kind: "hours", data: { hours: [{ weekday: 1, start_time: "09:15", end_time: "18:45" }] } })).not.toBeNull();
  });
  it("requires quarter-hour durations for new menus but retains legacy values for DB verification", () => {
    expect(parseSettingsChange({ kind: "service", data: { ...service, buffer_after: 10 } })).toBeNull();
    expect(parseSettingsChange({ kind: "service", data: { ...service, duration_minutes: 20 } })).toBeNull();
    expect(parseSettingsChange({ kind: "service", data: { ...service, duration_minutes: 45, buffer_after: 15 } })).not.toBeNull();
    expect(parseSettingsChange({ kind: "service", data: { ...service, id: "55555555-5555-5555-5555-555555555555", buffer_after: 10 } })).not.toBeNull();
  });
  it("accepts a trimmed name without trusting store IDs or timezone", () => {
    expect(parseSettingsChange({ kind: "store", data: { name: " 新店舗 ", store_id: "other", timezone: "UTC" } }))
      .toEqual({ kind: "store", data: { name: "新店舗" } });
  });
  it.each([null, [], { kind: "unknown", data: {} }, { kind: "store", data: { name: " " } }])("rejects invalid settings", input => {
    expect(parseSettingsChange(input)).toBeNull();
  });
  it("strips arbitrary service columns", () => {
    expect(parseSettingsChange({ kind: "service", data: { ...service, store_id: "other", reservations: [] } }))
      .toEqual({ kind: "service", data: service });
  });
  it.each([{ duration_minutes: 0 }, { price: -1 }, { price: 1.5 }, { buffer_after: null }, { active: "true" }, { id: "bad-id" }, { name: "a".repeat(101) }])("rejects invalid service fields", invalid => {
    expect(parseSettingsChange({ kind: "service", data: { ...service, ...invalid } })).toBeNull();
  });
  it("deduplicates staff assignments", () => {
    const id = "55555555-5555-5555-5555-555555555555";
    expect(parseSettingsChange({ kind: "staff", data: { name: "担当", active: true, serviceIds: [id, id] } }))
      .toEqual({ kind: "staff", data: { name: "担当", active: true, serviceIds: [id] } });
  });
  it("accepts an all-closed week and multiple non-overlapping periods", () => {
    expect(parseSettingsChange({ kind: "hours", data: { hours: [] } })).not.toBeNull();
    expect(parseSettingsChange({ kind: "hours", data: { hours: [
      { weekday: 1, start_time: "09:00", end_time: "12:00" }, { weekday: 1, start_time: "13:00", end_time: "18:00" },
    ] } })).not.toBeNull();
  });
  it.each([
    [{ weekday: 7, start_time: "09:00", end_time: "18:00" }],
    [{ weekday: 1, start_time: "09:10", end_time: "18:00" }],
    [{ weekday: 1, start_time: "18:00", end_time: "09:00" }],
    [{ weekday: 1, start_time: "09:00", end_time: "12:00" }, { weekday: 1, start_time: "11:30", end_time: "18:00" }],
  ].map(hours => ({ hours })))("rejects bad weekdays, off-grid times and overlapping periods", ({ hours }) => {
    expect(parseSettingsChange({ kind: "hours", data: { hours } })).toBeNull();
  });
});
