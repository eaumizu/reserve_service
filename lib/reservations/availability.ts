import type { TimeRange } from "./types";
export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
export function intervalsOverlap(a: TimeRange, b: TimeRange) { return a.start < b.end && b.start < a.end; }
/** A booking blocks treatment plus its per-service preparation and cleanup buffers. */
export function findAvailableStarts(params: { open: TimeRange[]; occupied: TimeRange[]; durationMinutes: number; bufferBefore: number; bufferAfter: number; intervalMinutes?: number }): Date[] {
  const { open, occupied, durationMinutes, bufferBefore, bufferAfter, intervalMinutes = 30 } = params;
  return open.flatMap(({ start, end }) => {
    const result: Date[] = [];
    for (let candidate = new Date(start); addMinutes(candidate, durationMinutes + bufferAfter) <= end; candidate = addMinutes(candidate, intervalMinutes)) {
      const protectedRange = { start: addMinutes(candidate, -bufferBefore), end: addMinutes(candidate, durationMinutes + bufferAfter) };
      if (!occupied.some((range) => intervalsOverlap(protectedRange, range))) result.push(candidate);
    }
    return result;
  });
}
