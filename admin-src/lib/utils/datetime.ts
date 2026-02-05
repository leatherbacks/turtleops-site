/**
 * Datetime utilities for timezone-aware date formatting
 * Uses project timezone from configuration
 */

/**
 * Format a date using the project timezone
 */
export function formatDateWithTimezone(
  date: Date | string,
  timezone: string = 'America/New_York',
  options?: Intl.DateTimeFormatOptions
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  };

  return dateObj.toLocaleString('en-US', defaultOptions);
}

/**
 * Format a date and time with timezone abbreviation
 */
export function formatDateTimeWithTimezone(
  date: Date | string,
  timezone: string = 'America/New_York'
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  const formatted = dateObj.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return formatted;
}

/**
 * Format just the time with timezone
 */
export function formatTimeWithTimezone(
  date: Date | string,
  timezone: string = 'America/New_York'
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  return dateObj.toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Get timezone abbreviation (EST, EDT, etc.)
 */
export function getTimezoneAbbreviation(
  timezone: string = 'America/New_York',
  date: Date = new Date()
): string {
  const formatted = date.toLocaleString('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  });

  // Extract timezone abbreviation (e.g., "EST", "EDT")
  const match = formatted.match(/\b([A-Z]{3,4})\b$/);
  return match ? match[1] : timezone;
}

/**
 * Format date range (e.g., "May 1 - Oct 31, 2025")
 */
export function formatDateRange(
  startDate: Date | string,
  endDate: Date | string,
  timezone: string = 'America/New_York'
): string {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  const startFormatted = start.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
  });

  const endFormatted = end.toLocaleString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${startFormatted} - ${endFormatted}`;
}

/**
 * Check if a date is during typical turtle nesting hours (7 PM - 6 AM)
 */
export function isNestingHours(
  date: Date | string,
  timezone: string = 'America/New_York'
): boolean {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Get hour in project timezone
  const hour = parseInt(dateObj.toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }));

  // Nesting hours: 7 PM (19:00) to 6 AM (06:00)
  return hour >= 19 || hour < 6;
}

/**
 * Format relative time (e.g., "2 hours ago", "yesterday")
 */
export function formatRelativeTime(
  date: Date | string,
  timezone: string = 'America/New_York'
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();

  const diffMs = now.getTime() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  // For older dates, show formatted date
  return formatDateWithTimezone(dateObj, timezone);
}
