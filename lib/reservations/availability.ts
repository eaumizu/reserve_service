import { TIME_STEP_MINUTES } from "./time-grid";
import type { TimeRange } from "./types";
export const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
export function intervalsOverlap(a: TimeRange, b: TimeRange) { return a.start < b.end && b.start < a.end; }
/** A booking blocks treatment plus its per-service preparation and cleanup buffers. */
export function findAvailableStarts(params: { open: TimeRange[]; occupied: TimeRange[]; durationMinutes: number; bufferBefore: number; bufferAfter: number; intervalMinutes?: number }): Date[] {
  const { open, occupied, durationMinutes, bufferBefore, bufferAfter, intervalMinutes = TIME_STEP_MINUTES } = params;
  // Convert once; Date comparisons otherwise coerce both ends on every candidate.
  const blocked = occupied.map(range => ({ start: range.start.getTime(), end: range.end.getTime() }));
  const beforeMs = bufferBefore * 60_000, afterMs = (durationMinutes + bufferAfter) * 60_000;
  return open.flatMap(({ start, end }) => {
    const result: Date[] = [];
    const close = end.getTime();
    for (let candidate = start.getTime(); candidate + afterMs <= close; candidate += intervalMinutes * 60_000) {
      if (!blocked.some(range => candidate - beforeMs < range.end && range.start < candidate + afterMs)) result.push(new Date(candidate));
    }
    return result;
  });
}
