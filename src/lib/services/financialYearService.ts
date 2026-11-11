/**
 * Computes the financial-year window (start/end/label) that contains
 * `referenceDate`, given the business's configured FY start month (1-12).
 * e.g. startMonth=4, referenceDate in Sept 2026 => FY "2026-2027"
 * (2026-04-01 to 2027-03-31). referenceDate in Feb 2026 => FY "2025-2026".
 */
export function computeCurrentFinancialYear(
  startMonth: number,
  referenceDate: Date = new Date()
): { startDate: Date; endDate: Date; label: string } {
  const refMonth = referenceDate.getUTCMonth() + 1; // 1-12
  const refYear = referenceDate.getUTCFullYear();

  const fyStartYear = refMonth >= startMonth ? refYear : refYear - 1;
  const fyEndYear = fyStartYear + 1;

  const startDate = new Date(Date.UTC(fyStartYear, startMonth - 1, 1, 0, 0, 0, 0));
  // End date is the day before the next FY starts.
  const endDate = new Date(Date.UTC(fyEndYear, startMonth - 1, 1, 0, 0, 0, 0));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  endDate.setUTCHours(23, 59, 59, 999);

  return { startDate, endDate, label: `${fyStartYear}-${fyEndYear}` };
}
