import { describe, expect, it } from "vitest";
import { findAvailableStarts, intervalsOverlap } from "../lib/reservations/availability";
describe("availability engine",()=>{it("removes starts that conflict with buffers",()=>{const d=(v:string)=>new Date(`2026-10-10T${v}:00Z`);const slots=findAvailableStarts({open:[{start:d("09:00"),end:d("11:00")}],occupied:[{start:d("09:50"),end:d("10:30")}],durationMinutes:30,bufferBefore:0,bufferAfter:10,intervalMinutes:30});expect(slots.map(x=>x.toISOString().slice(11,16))).toEqual(["09:00"]);});it("uses half-open intervals",()=>expect(intervalsOverlap({start:new Date(0),end:new Date(10)},{start:new Date(10),end:new Date(20)})).toBe(false));});

it("preserves the Date-based boundary contract with dense, overlapping and overnight conflicts", () => {
  let seed = 29;
  const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  const date = (minutes: number) => new Date(Date.parse("2030-01-01T00:00:00+09:00") + minutes * 60000);
  for (let sample = 0; sample < 100; sample++) {
    const durationMinutes = (1 + random(6)) * 15, bufferBefore = random(3) * 15, bufferAfter = random(3) * 15;
    const open = [{ start: date(0), end: date(180) }, { start: date(540), end: date(1080) }];
    const occupied = Array.from({ length: sample % 40 }, () => {
      const start = random(120) * 15 - 180;
      return { start: date(start), end: date(start + random(8) * 15) };
    });
    // Reference uses Dates and inclusive closing / exclusive conflict boundaries.
    const expected: string[] = [];
    for (const hours of open) {
      for (let t = new Date(hours.start); new Date(+t + (durationMinutes + bufferAfter) * 60000) <= hours.end; t = new Date(+t + 15 * 60000)) {
        const interval = { start: new Date(+t - bufferBefore * 60000), end: new Date(+t + (durationMinutes + bufferAfter) * 60000) };
        if (!occupied.some(block => intervalsOverlap(interval, block))) expected.push(t.toISOString());
      }
    }
    expect(findAvailableStarts({ open, occupied, durationMinutes, bufferBefore, bufferAfter }).map(t => t.toISOString())).toEqual(expected);
  }
});
