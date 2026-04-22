/**
 * Parse Wildlife Computers date format: "HH:MM:SS DD-Mon-YYYY"
 * Example: "18:37:45 12-Apr-2026"
 */
const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseWCDate(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const trimmed = dateStr.trim();

  // Format: "HH:MM:SS DD-Mon-YYYY"
  const match = trimmed.match(
    /^(\d{1,2}):(\d{2}):(\d{2})\s+(\d{1,2})-([A-Za-z]{3})-(\d{4})$/
  );

  if (match) {
    const [, hours, minutes, seconds, day, monthStr, year] = match;
    const month = MONTHS[monthStr.charAt(0).toUpperCase() + monthStr.slice(1).toLowerCase()];
    if (month === undefined) return null;

    return new Date(
      Date.UTC(
        parseInt(year),
        month,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes),
        parseInt(seconds)
      )
    );
  }

  // Fallback: try standard Date parsing
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}
