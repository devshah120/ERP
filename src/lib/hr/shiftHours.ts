/**
 * A shift's day lengths come from its times: a full day is start to end (a
 * night shift runs past midnight), a half day is half of that. Times that
 * can't be read (or are equal) give the fallback. Pure, so the shift form can
 * show the same figures the server stores.
 */
export function shiftHours(
  startTime: string | undefined | null,
  endTime: string | undefined | null,
  fallback = { fullDayHours: 8, halfDayHours: 4 }
): { fullDayHours: number; halfDayHours: number } {
  const at = (t: string | undefined | null) => {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? "").trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = at(startTime);
  const end = at(endTime);
  if (start === null || end === null || start === end) return fallback;
  const minutes = end > start ? end - start : end + 24 * 60 - start;
  // Whole minutes ÷ 60 can repeat (e.g. 8h 20m), so round to 2 places for storage and display.
  return { fullDayHours: Math.round((minutes / 60) * 100) / 100, halfDayHours: Math.round((minutes / 120) * 100) / 100 };
}
