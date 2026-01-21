/**
 * Timezone utilities for converting slot times between timezones
 */

/**
 * Timezone offset map (hours from UTC)
 * Positive = behind UTC (Americas), Negative = ahead of UTC (Europe/Asia)
 */
export const TIMEZONE_OFFSETS: Record<string, number> = {
  // US Timezones
  'EST': -5, 'EDT': -4, 'CST': -6, 'CDT': -5, 'MST': -7, 'MDT': -6, 'PST': -8, 'PDT': -7,
  // UTC/GMT
  'UTC': 0, 'GMT': 0,
  // Europe
  'WET': 0, 'WEST': 1, 'CET': 1, 'CEST': 2, 'EET': 2, 'EEST': 3, 'BST': 1,
  // Asia
  'IST': 5.5, 'PKT': 5, 'ICT': 7, 'CST_CHINA': 8, 'SGT': 8, 'JST': 9, 'KST': 9, 'AEST': 10, 'AEDT': 11,
  // IANA-style timezone names (common ones)
  'America/New_York': -5, 'America/Chicago': -6, 'America/Denver': -7, 'America/Los_Angeles': -8,
  'America/Phoenix': -7, 'America/Anchorage': -9, 'Pacific/Honolulu': -10,
  'Europe/London': 0, 'Europe/Paris': 1, 'Europe/Berlin': 1, 'Europe/Moscow': 3,
  'Asia/Dubai': 4, 'Asia/Kolkata': 5.5, 'Asia/Bangkok': 7, 'Asia/Shanghai': 8, 'Asia/Tokyo': 9, 'Asia/Singapore': 8,
  'Australia/Sydney': 11, 'Pacific/Auckland': 13,
  // Israel
  'Asia/Jerusalem': 2, 'ISR': 2, 'IDT': 3,
};

/**
 * Get timezone offset in hours from UTC
 */
export function getTimezoneOffset(timezone: string): number | undefined {
  return TIMEZONE_OFFSETS[timezone] ?? TIMEZONE_OFFSETS[timezone.toUpperCase()];
}

/**
 * Parse a time string like "1:30 PM" or "13:30" and return hour (24h) and minute
 */
export function parseTime(timeStr: string): { hour: number; minute: number } | null {
  // Try 12-hour format: "1:30 PM" or "1:30PM"
  const match12h = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12h) {
    let hour = parseInt(match12h[1], 10);
    const minute = parseInt(match12h[2], 10);
    const isPM = match12h[3].toUpperCase() === 'PM';

    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;

    return { hour, minute };
  }

  // Try 24-hour format: "13:30"
  const match24h = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    return {
      hour: parseInt(match24h[1], 10),
      minute: parseInt(match24h[2], 10)
    };
  }

  return null;
}

/**
 * Format hour/minute back to 12-hour format
 */
export function formatTime12h(hour: number, minute: number): string {
  const ampm = hour >= 12 ? 'PM' : 'AM';
  let displayHour = hour;
  if (displayHour > 12) displayHour -= 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
}

/**
 * Convert a time from source timezone to target timezone
 * @param dateStr Date string in YYYY-MM-DD format
 * @param timeStr Time string (e.g., "1:30 PM" or "13:30")
 * @param sourceTimezone Source timezone (e.g., "CST", "America/Chicago")
 * @param targetTimezone Target timezone (e.g., "EST", "America/New_York")
 * @returns Converted time and date, or null if conversion fails
 */
export function convertTimezone(
  dateStr: string,
  timeStr: string,
  sourceTimezone: string,
  targetTimezone: string
): { date: string; time: string } | null {
  const sourceOffset = getTimezoneOffset(sourceTimezone);
  const targetOffset = getTimezoneOffset(targetTimezone);

  if (sourceOffset === undefined || targetOffset === undefined) {
    console.warn(`Unknown timezone: source=${sourceTimezone}, target=${targetTimezone}`);
    return null;
  }

  const parsed = parseTime(timeStr);
  if (!parsed) {
    console.warn(`Could not parse time: ${timeStr}`);
    return null;
  }

  // Parse date
  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) {
    console.warn(`Could not parse date: ${dateStr}`);
    return null;
  }

  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
  const day = parseInt(dateParts[2], 10);

  // Create date in source timezone
  const date = new Date(year, month, day, parsed.hour, parsed.minute);

  // Calculate offset difference and apply
  const offsetDiff = targetOffset - sourceOffset;
  date.setHours(date.getHours() + offsetDiff);

  // Extract converted values
  const convertedYear = date.getFullYear();
  const convertedMonth = date.getMonth() + 1;
  const convertedDay = date.getDate();
  const convertedHour = date.getHours();
  const convertedMinute = date.getMinutes();

  const newDateStr = `${convertedYear}-${String(convertedMonth).padStart(2, '0')}-${String(convertedDay).padStart(2, '0')}`;
  const newTimeStr = formatTime12h(convertedHour, convertedMinute);

  return { date: newDateStr, time: newTimeStr };
}

/**
 * Convert all slots in a scraping result to a target timezone
 * @param slots Array of slot objects with date, time, gmt fields
 * @param sourceTimezone Source timezone (calendar's timezone)
 * @param targetTimezone Target timezone (user's timezone)
 * @returns New array with converted times
 */
export function convertSlotsTimezone(
  slots: Array<{ date: string; time: string; gmt: string }>,
  sourceTimezone: string,
  targetTimezone: string
): Array<{ date: string; time: string; gmt: string; original_time?: string; original_timezone?: string }> {
  if (!sourceTimezone || !targetTimezone || sourceTimezone === targetTimezone) {
    return slots;
  }

  console.log(`🕐 Converting ${slots.length} slots from ${sourceTimezone} to ${targetTimezone}`);

  return slots.map(slot => {
    const converted = convertTimezone(slot.date, slot.time, sourceTimezone, targetTimezone);
    if (converted) {
      return {
        date: converted.date,
        time: converted.time,
        gmt: slot.gmt, // Keep original GMT offset info
        original_time: slot.time,
        original_timezone: sourceTimezone
      };
    }
    return slot;
  });
}

/**
 * Try to detect timezone from GMT offset string like "GMT-6" or "UTC+2"
 */
export function detectTimezoneFromGmt(gmtString: string): string | null {
  const match = gmtString.match(/(?:GMT|UTC)\s*([+-]?\d+(?:\.\d+)?)/i);
  if (match) {
    const offset = parseFloat(match[1]);
    // Find a timezone with this offset
    for (const [tz, tzOffset] of Object.entries(TIMEZONE_OFFSETS)) {
      if (tzOffset === -offset) { // Note: GMT offsets are inverted
        return tz;
      }
    }
  }
  return null;
}
