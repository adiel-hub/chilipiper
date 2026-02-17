import { NextRequest, NextResponse } from 'next/server';
import { SecurityMiddleware, ValidationSchemas } from '@/lib/security-middleware';
import { concurrencyManager } from '@/lib/concurrency-manager';
import { ErrorHandler, ErrorCode, SuccessCode } from '@/lib/error-handler';
import { browserInstanceManager } from '@/lib/browser-instance-manager';
import { ChiliPiperScraper } from '@/lib/scraper';
import { browserPool } from '@/lib/browser-pool';

const security = new SecurityMiddleware();

/**
 * Timezone offset map (hours from UTC)
 * Positive = behind UTC (Americas), Negative = ahead of UTC (Europe/Asia)
 */
const TIMEZONE_OFFSETS: Record<string, number> = {
  // US Timezones
  'EST': -5, 'EDT': -4, 'CST': -6, 'CDT': -5, 'MST': -7, 'MDT': -6, 'PST': -8, 'PDT': -7,
  // UTC/GMT
  'UTC': 0, 'GMT': 0,
  // Europe
  'WET': 0, 'WEST': 1, 'CET': 1, 'CEST': 2, 'EET': 2, 'EEST': 3,
  // Asia
  'IST': 5.5, 'PKT': 5, 'BST': 6, 'ICT': 7, 'CST_CHINA': 8, 'JST': 9, 'KST': 9, 'AEST': 10, 'AEDT': 11,
  // IANA-style timezone names (common ones)
  'America/New_York': -5, 'America/Chicago': -6, 'America/Denver': -7, 'America/Los_Angeles': -8,
  'America/Phoenix': -7, 'America/Anchorage': -9, 'Pacific/Honolulu': -10,
  'Europe/London': 0, 'Europe/Paris': 1, 'Europe/Berlin': 1, 'Europe/Moscow': 3,
  'Asia/Dubai': 4, 'Asia/Kolkata': 5.5, 'Asia/Bangkok': 7, 'Asia/Shanghai': 8, 'Asia/Tokyo': 9,
  'Australia/Sydney': 11, 'Pacific/Auckland': 13,
  // Israel
  'Asia/Jerusalem': 2, 'ISR': 2, 'IDT': 3,
};

/**
 * Parse date/time string like "November 13, 2025 at 1:25 PM"
 * Optionally converts from source timezone to target timezone
 * Returns { date: "2025-11-13", time: "1:25 PM" }
 */
function parseDateTime(
  dateTimeString: string,
  sourceTimezone?: string,
  targetTimezone?: string
): { date: string; time: string } | null {
  try {
    // Remove day of week if present (e.g., "Tuesday, February 17, 2026..." -> "February 17, 2026...")
    let cleaned = dateTimeString.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, '');

    // Extract timezone from string if present (e.g., "... CST" or "... America/Chicago")
    let extractedTz: string | null = null;

    // Try to extract IANA-style timezone first (e.g., America/Chicago)
    const ianaMatch = dateTimeString.match(/\s+([A-Za-z]+\/[A-Za-z_]+)[\s,]*$/);
    if (ianaMatch) {
      extractedTz = ianaMatch[1];
      cleaned = dateTimeString.replace(/\s+[A-Za-z]+\/[A-Za-z_]+[\s,]*$/, '').trim();
    } else {
      // Try abbreviated timezone (CST, EST, etc.) - but NOT AM/PM
      const tzMatch = dateTimeString.match(/\s+([A-Z]{2,4})[\s,]*$/i);
      if (tzMatch && !['AM', 'PM'].includes(tzMatch[1].toUpperCase())) {
        extractedTz = tzMatch[1].toUpperCase();
        cleaned = dateTimeString.replace(/\s+[A-Z]{2,4}[\s,]*$/i, '').trim();
      }
    }

    // Use extracted timezone if no source timezone provided
    const effectiveSourceTz = sourceTimezone || extractedTz || null;

    // Pattern: "November 13, 2025 at 1:25 PM" or "November 13, 2025 at 1:25PM"
    const match = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

    if (!match) {
      // Try alternative format without "at"
      const altMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (altMatch) {
        return parseDateTimeComponents(altMatch, effectiveSourceTz, targetTimezone);
      }
      return null;
    }

    return parseDateTimeComponents(match, effectiveSourceTz, targetTimezone);
  } catch (error) {
    console.error('Error parsing date/time:', error);
    return null;
  }
}

/**
 * Parse date/time components and optionally convert timezone
 */
function parseDateTimeComponents(
  match: RegExpMatchArray,
  sourceTimezone: string | null,
  targetTimezone?: string
): { date: string; time: string } | null {
  const [, monthName, day, year, hour, minute, ampm] = match;
  const monthMap: Record<string, number> = {
    'january': 1, 'jan': 1, 'february': 2, 'feb': 2,
    'march': 3, 'mar': 3, 'april': 4, 'apr': 4,
    'may': 5, 'june': 6, 'jun': 6, 'july': 7, 'jul': 7,
    'august': 8, 'aug': 8, 'september': 9, 'sep': 9, 'sept': 9,
    'october': 10, 'oct': 10, 'november': 11, 'nov': 11,
    'december': 12, 'dec': 12
  };

  const month = monthMap[monthName.toLowerCase()];
  if (!month) return null;

  let hourNum = parseInt(hour, 10);
  const minuteNum = parseInt(minute, 10);
  const isPM = ampm.toUpperCase() === 'PM';

  // Convert to 24-hour format for calculations
  if (isPM && hourNum !== 12) hourNum += 12;
  if (!isPM && hourNum === 12) hourNum = 0;

  // If timezone conversion is needed
  if (sourceTimezone && targetTimezone && sourceTimezone !== targetTimezone) {
    const sourceOffset = TIMEZONE_OFFSETS[sourceTimezone] ?? TIMEZONE_OFFSETS[sourceTimezone.toUpperCase()];
    const targetOffset = TIMEZONE_OFFSETS[targetTimezone] ?? TIMEZONE_OFFSETS[targetTimezone.toUpperCase()];

    if (sourceOffset !== undefined && targetOffset !== undefined) {
      // Create a date object for timezone conversion
      const date = new Date(
        parseInt(year, 10),
        month - 1,
        parseInt(day, 10),
        hourNum,
        minuteNum
      );

      // Calculate offset difference (in hours)
      const offsetDiff = targetOffset - sourceOffset;

      // Apply offset
      date.setHours(date.getHours() + offsetDiff);

      // Extract converted values
      const convertedYear = date.getFullYear();
      const convertedMonth = date.getMonth() + 1;
      const convertedDay = date.getDate();
      let convertedHour = date.getHours();
      const convertedMinute = date.getMinutes();

      // Convert back to 12-hour format
      const convertedAmPm = convertedHour >= 12 ? 'PM' : 'AM';
      if (convertedHour > 12) convertedHour -= 12;
      if (convertedHour === 0) convertedHour = 12;

      const dateStr = `${convertedYear}-${String(convertedMonth).padStart(2, '0')}-${String(convertedDay).padStart(2, '0')}`;
      const timeStr = `${convertedHour}:${String(convertedMinute).padStart(2, '0')} ${convertedAmPm}`;

      console.log(`🕐 Timezone conversion: ${sourceTimezone} -> ${targetTimezone} (offset: ${offsetDiff}h)`);
      console.log(`   Input: ${year}-${month}-${day} ${hour}:${minute} ${ampm}`);
      console.log(`   Output: ${dateStr} ${timeStr}`);

      return { date: dateStr, time: timeStr };
    } else {
      console.warn(`⚠️ Unknown timezone: source=${sourceTimezone}, target=${targetTimezone}`);
    }
  }

  // No conversion needed - return as-is
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${hour}:${minute} ${ampm.toUpperCase()}`;
  return { date: dateStr, time: timeStr };
}

/**
 * Format time for slot button data-test-id
 * "1:25 PM" -> "1:25PM" (no space, uppercase AM/PM)
 */
function formatTimeForSlot(time: string): string {
  return time.replace(/\s+/g, '').toUpperCase();
}

/**
 * Build parameterized URL - only includes non-empty fields
 * Supports custom_params for any additional Chili Piper form fields
 */
function buildParameterizedUrlOptional(
  firstName: string,
  lastName: string,
  email: string,
  phone: string,
  baseUrl: string,
  phoneFieldId: string,
  customParams?: Record<string, string>
): string {
  const urlParts = new URL(baseUrl);
  const params = new URLSearchParams();

  // Only add non-empty standard fields
  if (firstName) params.append('PersonFirstName', firstName);
  if (lastName) params.append('PersonLastName', lastName);
  if (email) params.append('PersonEmail', email);
  if (phone) {
    const phoneValue = phone.startsWith('+') ? phone : `+${phone}`;
    params.append(phoneFieldId, phoneValue);
  }

  // Add any custom parameters
  if (customParams && typeof customParams === 'object') {
    for (const [key, value] of Object.entries(customParams)) {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    }
  }

  const existingParams = new URLSearchParams(urlParts.search);
  for (const [key, value] of Array.from(params.entries())) {
    existingParams.set(key, value);
  }

  return `${urlParts.origin}${urlParts.pathname}?${existingParams.toString()}`;
}

/**
 * Create a new browser instance and navigate to calendar
 * All person fields are optional - only include what your Chili Piper form requires
 */
async function createInstanceForEmail(
  email: string,
  firstName: string,
  lastName: string,
  phone: string,
  chiliPiperUrl: string,
  customParams?: Record<string, string>,
  userTimezone?: string // User's timezone - browser will emulate this timezone so times match what user sees
): Promise<{ browser: any; context: any; page: any } | null> {
  let browser: any = null;
  let context: any = null;
  let page: any = null;
  let releaseLock: (() => void) | null = null;

  try {
    if (!chiliPiperUrl) {
      throw new Error('chili_piper_url is required');
    }
    const phoneFieldId = 'aa1e0f82-816d-478f-bf04-64a447af86b3';
    const targetUrl = buildParameterizedUrlOptional(firstName, lastName, email, phone, chiliPiperUrl, phoneFieldId, customParams);
    
    browser = await browserPool.getBrowser();
    
    // Acquire lock for context creation to prevent race conditions
    releaseLock = await browserPool.acquireContextLock(browser);
    
    // Retry logic for browser context creation (handles race conditions)
    let retries = 3;
    while (retries > 0) {
      try {
        // Check browser connection before creating context
        if (!browser.isConnected()) {
          console.log('⚠️ Browser disconnected, getting new browser instance...');
          // Release lock and browser before getting new one
          if (releaseLock) releaseLock();
          browserPool.releaseBrowser(browser);
          browser = await browserPool.getBrowser();
          releaseLock = await browserPool.acquireContextLock(browser);
        }
        // Create a context with user's timezone (or default to US Central Time)
        // This makes Chili Piper display times in the same timezone the user expects
        const browserTimezone = userTimezone || 'America/Chicago';
        console.log(`🕐 Setting browser timezone to: ${browserTimezone}`);
        context = await browser.newContext({
          timezoneId: browserTimezone,
        });
        page = await context.newPage();
        break; // Success, exit retry loop
      } catch (error: any) {
        retries--;
        if (error.message && error.message.includes('has been closed') && retries > 0) {
          console.log(`⚠️ Browser/context closed, retrying... (${retries} attempts left)`);
          // Release lock and browser before getting new one
          if (releaseLock) releaseLock();
          browserPool.releaseBrowser(browser);
          browser = await browserPool.getBrowser();
          releaseLock = await browserPool.acquireContextLock(browser);
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          // Release lock and browser on error
          if (releaseLock) releaseLock();
          browserPool.releaseBrowser(browser);
          throw error; // Re-throw if not a "closed" error or no retries left
        }
      }
    }
    
    // Release lock after context is created
    if (releaseLock) {
      releaseLock();
      releaseLock = null;
    }
    
    if (!page) {
      browserPool.releaseBrowser(browser);
      throw new Error('Failed to create browser context after retries');
    }
    
    page.setDefaultNavigationTimeout(6000);
    await page.route("**/*", (route: any) => {
      const url = route.request().url();
      const rt = route.request().resourceType();
      if (rt === 'image' || rt === 'stylesheet' || rt === 'font' || rt === 'media' ||
          url.includes('google-analytics') || url.includes('googletagmanager') || url.includes('analytics') ||
          url.includes('facebook.net') || url.includes('doubleclick') || url.includes('ads') || url.includes('tracking') ||
          url.includes('pixel') || url.includes('beacon')) {
        route.abort();
        return;
      }
      route.continue();
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 6000 });
    
    // Click submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Continue")',
      '[data-test-id="GuestForm-submit-button"]',
    ];
    
    for (const selector of submitSelectors) {
      try {
        await page.click(selector, { timeout: 500 });
        break;
      } catch {}
    }

    // Click schedule button if present
    const scheduleSelectors = [
      '[data-test-id="ConciergeLiveBox-book"]',
      '[data-id="concierge-live-book"]',
      'button:has-text("Schedule a meeting")',
      'button:has-text("Schedule")',
    ];

    for (const selector of scheduleSelectors) {
      try {
        await page.click(selector, { timeout: 500 });
        break;
      } catch {}
    }

    // Wait for calendar
    await page.waitForSelector('[data-id="calendar-day-button"], button[data-test-id^="days:"]', { timeout: 5000 });
    
    return { browser, context, page };
  } catch (error) {
    console.error('Error creating instance:', error);
    
    // Clean up on error
    try {
      if (releaseLock) {
        releaseLock();
      }
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      if (context) {
        await context.close().catch(() => {});
      }
      if (browser) {
        browserPool.releaseBrowser(browser);
      }
    } catch (cleanupError) {
      // Ignore cleanup errors
    }
    
    return null;
  }
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📅 [BOOK-SLOT] ===== NEW BOOKING REQUEST =====");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`📋 [BOOK-SLOT] Request ID: ${requestId}`);
    console.log(`⏰ [BOOK-SLOT] Timestamp: ${new Date().toISOString()}`);
    console.log(`🌐 [BOOK-SLOT] Request URL: ${request.url}`);
    console.log(`📍 [BOOK-SLOT] Client IP: ${request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"}`);
    console.log(`🤖 [BOOK-SLOT] User Agent: ${request.headers.get("user-agent") || "unknown"}`);

    // Log raw request body
    try {
      const clonedRequest = request.clone();
      const rawBody = await clonedRequest.text();
      console.log(`📦 [BOOK-SLOT] Raw Request Body:`);
      console.log(rawBody);
    } catch (e) {
      console.log(`⚠️ [BOOK-SLOT] Could not log raw body: ${e}`);
    }

    // Apply security middleware (no auth required - public API)
    console.log(`🔒 [BOOK-SLOT] Applying security middleware...`);
    const securityResult = await security.secureRequest(request, {
      requireAuth: false, // Public API - no authentication required
      rateLimit: { maxRequests: 100, windowMs: 15 * 60 * 1000 }, // 100 requests per 15 minutes
      inputSchema: {
        type: 'object',
        required: ['dateTime', 'chili_piper_url'],
        properties: {
          // Person fields - all optional (use what your Chili Piper form requires)
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          phone: { type: 'string' },
          // Custom parameters for Chili Piper form (any additional fields)
          custom_params: { type: 'object' },
          // Required fields
          dateTime: { type: 'string' },
          chili_piper_url: { type: 'string' },
          // Timezone support - browser will emulate user's timezone so Chili Piper displays times in their timezone
          timezone: { type: 'string' }, // User's timezone (e.g., "America/New_York", "Asia/Jerusalem") - browser will emulate this
        },
      },
      allowedMethods: ['POST'],
    });

    if (!securityResult.allowed) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.UNAUTHORIZED,
        'Request blocked by security middleware',
        securityResult.response?.statusText || 'Authentication or validation failed',
        undefined,
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: ErrorHandler.getStatusCode(errorResponse.code) }
      );
      return security.addSecurityHeaders(response);
    }

    const body = securityResult.sanitizedData!;

    // Extract contact fields from custom_params if not provided at top level
    // This supports platforms that send contact info nested in custom_params
    let email = body.email || '';
    let firstName = body.firstName || '';
    let lastName = body.lastName || '';
    let phone = body.phone || '';

    if (body.custom_params && typeof body.custom_params === 'object') {
      const params = body.custom_params as Record<string, any>;
      firstName = firstName || params.firstname || params.first_name || '';
      lastName = lastName || params.lastname || params.last_name || '';
      phone = phone || params.phone || '';
      email = email || params.email || '';
    }

    const { dateTime, chili_piper_url, custom_params, timezone } = body;

    // Parse date/time - no timezone conversion needed since browser will emulate user's timezone
    // The times displayed by Chili Piper will match what the user expects
    if (timezone) {
      console.log(`🕐 [BOOK-SLOT] User timezone: ${timezone} (browser will emulate this timezone)`);
    }

    console.log(`🔍 [BOOK-SLOT] About to parse dateTime: "${dateTime}"`);
    const parsed = parseDateTime(dateTime);
    console.log(`📊 [BOOK-SLOT] parseDateTime result:`, parsed);
    if (!parsed) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid date/time format',
        'Date/time must be in format like "November 13, 2025 at 1:25 PM CST"',
        { providedValue: dateTime },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 400 }
      );
      return security.addSecurityHeaders(response);
    }

    const { date, time } = parsed;
    const formattedTime = formatTimeForSlot(time);

    console.log(`✅ [BOOK-SLOT] Security check PASSED`);
    console.log(`📋 [BOOK-SLOT] Parsed dateTime: ${date} ${time}`);
    console.log(`📋 [BOOK-SLOT] Formatted time for slot: ${formattedTime}`);
    console.log(`👤 [BOOK-SLOT] Email: ${email}`);
    console.log(`👤 [BOOK-SLOT] Name: ${firstName} ${lastName}`);
    console.log(`📞 [BOOK-SLOT] Phone: ${phone}`);
    console.log(`🔗 [BOOK-SLOT] Chili Piper URL: ${chili_piper_url}`);
    if (timezone) {
      console.log(`🕐 [BOOK-SLOT] User Timezone: ${timezone}`);
    }
    if (custom_params) {
      console.log(`📦 [BOOK-SLOT] Custom Params:`, JSON.stringify(custom_params));
    }

    // Test mode: If email contains "test", return success without actually booking
    if (email.toLowerCase().includes('test')) {
      console.log(`🧪 [BOOK-SLOT] TEST MODE ACTIVATED - Email contains "test"`);
      console.log(`🧪 [BOOK-SLOT] Returning mock success response without actual booking`);
      const responseTime = Date.now() - requestStartTime;

      // Format dateTime with timezone
      const formatDateTime = (dateStr: string, timeStr: string, tz?: string): string => {
        try {
          const [year, month, day] = dateStr.split('-').map(Number);
          const dateObj = new Date(year, month - 1, day);
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];

          // Get timezone abbreviation
          let tzAbbr = '';
          if (tz) {
            const tzMap: Record<string, string> = {
              'Asia/Jerusalem': 'IST',
              'America/New_York': 'EST',
              'America/Chicago': 'CST',
              'America/Denver': 'MST',
              'America/Los_Angeles': 'PST',
              'Europe/London': 'GMT',
              'Europe/Paris': 'CET',
              'UTC': 'UTC',
              'GMT': 'GMT',
            };
            tzAbbr = tzMap[tz] || tz.split('/').pop()?.toUpperCase() || '';
          }

          const formatted = `${dayNames[dateObj.getDay()]}, ${monthNames[month - 1]} ${day}, ${year} at ${timeStr}`;
          return tzAbbr ? `${formatted} ${tzAbbr}` : formatted;
        } catch (error) {
          return `${dateStr} at ${timeStr}`;
        }
      };

      const successResponse = ErrorHandler.createSuccess(
        SuccessCode.OPERATION_SUCCESS,
        {
          message: 'Slot booked successfully (TEST MODE - no actual booking performed)',
          date: date,
          time: time,
          dateTime: formatDateTime(date, time, timezone),
          testMode: true,
        },
        requestId,
        responseTime
      );

      const response = NextResponse.json(
        successResponse,
        { status: ErrorHandler.getSuccessStatusCode() }
      );
      return security.addSecurityHeaders(response);
    }

    console.log("\n───────────────────────────────────────────────────────");
    console.log("🚀 [BOOK-SLOT] ===== STARTING BOOKING PROCESS =====");
    console.log("───────────────────────────────────────────────────────");
    console.log(`🎯 [BOOK-SLOT] Target Date: ${date}`);
    console.log(`🎯 [BOOK-SLOT] Target Time: ${time}`);
    console.log(`🎯 [BOOK-SLOT] Slot ID to click: slot-${formattedTime}`);

    // Run booking through concurrency manager
    const bookingStartTime = Date.now();
    console.log(`🚀 [BOOK-SLOT] Executing booking task...`);

    const result = await concurrencyManager.execute(async () => {
      console.log(`🏗️ [BOOK-SLOT] Creating scraper instance...`);
      const scraper = new ChiliPiperScraper(chili_piper_url);

      // Try to get existing instance (use email if provided, otherwise generate unique key)
      const instanceKey = email || `booking_${Date.now()}`;
      console.log(`🔍 [BOOK-SLOT] Looking for existing browser instance for: ${instanceKey}`);
      let instance = email ? scraper.getExistingInstance(email) : null;
      let browser: any = null;
      let context: any = null;
      let page: any = null;

      if (!instance) {
        console.log(`📝 [BOOK-SLOT] No existing instance found for ${instanceKey}`);
        console.log(`🆕 [BOOK-SLOT] Creating new browser instance...`);

        const newInstance = await createInstanceForEmail(
          email || '',
          firstName || '',
          lastName || '',
          phone || '',
          chili_piper_url,
          custom_params,
          timezone // User's timezone - browser will emulate this so times match
        );

        if (!newInstance) {
          console.error(`❌ [BOOK-SLOT] Failed to create browser instance`);
          throw new Error('Failed to create browser instance');
        }

        console.log(`✅ [BOOK-SLOT] New browser instance created successfully`);
        browser = newInstance.browser;
        context = newInstance.context;
        page = newInstance.page;

        // Register the instance
        console.log(`📝 [BOOK-SLOT] Registering browser instance...`);
        await browserInstanceManager.registerInstance(email, browser, context, page);
        console.log(`✅ [BOOK-SLOT] Browser instance registered`);
      } else {
        console.log(`♻️ [BOOK-SLOT] Using existing browser instance for ${email}`);
        browser = instance.browser;
        context = instance.context;
        page = instance.page;
      }

      // Verify page is still valid
      if (page.isClosed()) {
        throw new Error('Browser page was closed');
      }

      // Ensure we're on calendar view
      try {
        await page.waitForSelector('[data-id="calendar-day-button"], button[data-test-id^="days:"]', { timeout: 3000 });
      } catch {
        throw new Error('Calendar not found on page');
      }

      // Find and click the day button
      console.log(`📅 [BOOK-SLOT] Looking for day buttons on calendar...`);
      const dayButtons = await page.$$('[data-id="calendar-day-button"], button[data-test-id^="days:"]');
      console.log(`📅 [BOOK-SLOT] Found ${dayButtons.length} day buttons`);

      let dayClicked = false;

      for (const button of dayButtons) {
        try {
          const buttonText = await button.textContent();
          if (!buttonText) continue;
          
          // Check if this button matches our target date
          // Button text format: "Monday 13th November Mon13Nov" or similar
          const dateMatch = buttonText.match(/(\d{1,2})(?:st|nd|rd|th)/i);
          if (!dateMatch) continue;
          
          const day = parseInt(dateMatch[1], 10);
          const targetDay = parseInt(date.split('-')[2], 10);
          
          // Also check month
          const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                             'july', 'august', 'september', 'october', 'november', 'december'];
          const targetMonth = parseInt(date.split('-')[1], 10);
          const targetMonthName = monthNames[targetMonth - 1];
          
          const buttonTextLower = buttonText.toLowerCase();
          const hasTargetMonth = buttonTextLower.includes(targetMonthName) || 
                                buttonTextLower.includes(targetMonthName.substring(0, 3));
          
          if (day === targetDay && hasTargetMonth) {
            console.log(`✅ [BOOK-SLOT] Found matching day button: ${buttonText.substring(0, 50)}`);
            console.log(`🖱️ [BOOK-SLOT] Clicking day button for ${date}...`);
            await button.click();
            dayClicked = true;
            console.log(`✅ [BOOK-SLOT] Day button clicked successfully`);
            break;
          } else {
            console.log(`⏭️ [BOOK-SLOT] Skipping button (day=${day}, targetDay=${targetDay}, hasMonth=${hasTargetMonth})`);
          }
        } catch (error) {
          console.log(`⚠️ [BOOK-SLOT] Error processing button: ${error}`);
          continue;
        }
      }

      if (!dayClicked) {
        console.error(`❌ [BOOK-SLOT] Day button NOT FOUND for date ${date}`);
        console.error(`❌ [BOOK-SLOT] Checked ${dayButtons.length} buttons`);
        throw new Error(`Day button not found for date ${date}`);
      }

      // Wait for slots to load - use reliable wait condition
      try {
        await page.waitForSelector('[data-id="calendar-slot"], button[data-test-id^="slot-"]', { timeout: 2000 });
        console.log(`✅ Slot buttons appeared after clicking day button`);
      } catch (error) {
        // If slots don't appear, wait a bit more and try again
        await page.waitForTimeout(500);
        const slotsExist = await page.$('[data-id="calendar-slot"], button[data-test-id^="slot-"]');
        if (!slotsExist) {
          throw new Error(`No slot buttons found after clicking day button for ${date}`);
        }
      }

      // Log available slots for debugging
      try {
        const availableSlots = await page.$$eval('[data-id="calendar-slot"], button[data-test-id^="slot-"]', 
          (buttons: Element[]) => buttons.map((b: Element) => ({
            text: b.textContent?.trim() || '',
            dataTestId: b.getAttribute('data-test-id') || '',
            disabled: b.hasAttribute('disabled') || (b as HTMLButtonElement).disabled,
            ariaDisabled: b.getAttribute('aria-disabled') === 'true'
          }))
        );
        console.log(`🔍 Available slots (${availableSlots.length} total):`, 
          availableSlots.map((s: { text: string; dataTestId: string; disabled: boolean; ariaDisabled: boolean }) => `${s.text} (${s.dataTestId})`).join(', '));
      } catch (error) {
        console.log(`⚠️ Could not log available slots:`, error);
      }

      // Find and click the time slot button
      console.log(`⏰ [BOOK-SLOT] Looking for time slot button...`);
      const slotTimeId = `slot-${formattedTime}`;
      console.log(`🎯 [BOOK-SLOT] Target slot ID: ${slotTimeId}`);
      console.log(`🎯 [BOOK-SLOT] Target time: ${time}`);

      let slotClicked = false;
      
      // Helper function to normalize time for comparison
      const normalizeTime = (timeStr: string): string => {
        return timeStr.trim()
          .replace(/\s+/g, '') // Remove all spaces
          .toUpperCase()
          .replace(/^0+/, ''); // Remove leading zeros (e.g., "09:30" -> "9:30")
      };

      // Helper function to check if times match
      const timesMatch = (time1: string, time2: string): boolean => {
        const norm1 = normalizeTime(time1);
        const norm2 = normalizeTime(time2);
        return norm1 === norm2;
      };
      
      // Try exact data-test-id match first (with variations)
      const slotIdVariations = [
        slotTimeId, // "slot-5:00PM"
        `slot-${time.replace(/\s+/g, '')}`, // "slot-5:00 PM" -> "slot-5:00PM"
        `slot-${time.replace(/\s+/g, '').toUpperCase()}`, // "slot-5:00PM" (already uppercase)
        `slot-${time.replace(/\s+/g, '').toLowerCase()}`, // "slot-5:00pm"
      ];
      
      for (const slotId of slotIdVariations) {
        try {
          const slotButton = await page.$(`button[data-test-id="${slotId}"]`);
          if (slotButton) {
            const isDisabled = await slotButton.evaluate((el: any) => 
              el.disabled || el.getAttribute('aria-disabled') === 'true'
            );
            if (!isDisabled) {
              await slotButton.click();
              slotClicked = true;
              console.log(`✅ Clicked time slot button by data-test-id: ${slotId}`);
              break;
            } else {
              console.log(`⚠️ Slot button found but is disabled: ${slotId}`);
            }
          }
        } catch (error) {
          continue;
        }
      }

      // Fallback: try by text content with improved matching
      if (!slotClicked) {
        const slotButtons = await page.$$('[data-id="calendar-slot"], button[data-test-id^="slot-"]');
        console.log(`🔍 Trying text matching on ${slotButtons.length} slot buttons...`);
        
        for (const button of slotButtons) {
          try {
            const buttonText = await button.textContent();
            if (!buttonText) continue;
            
            // Check if button is disabled
            const isDisabled = await button.evaluate((el: any) => 
              el.disabled || el.getAttribute('aria-disabled') === 'true'
            );
            if (isDisabled) {
              console.log(`⚠️ Skipping disabled slot: ${buttonText.trim()}`);
              continue;
            }
            
            // Try multiple matching strategies
            const trimmedText = buttonText.trim();
            const normalizedButtonTime = normalizeTime(trimmedText);
            const normalizedTargetTime = normalizeTime(time);
            
            // Match strategies:
            // 1. Exact normalized match (e.g., "5:00PM" === "5:00PM")
            // 2. Original text match (e.g., "5:00 PM" === "5:00 PM")
            // 3. Case-insensitive match
            if (normalizedButtonTime === normalizedTargetTime || 
                trimmedText.toUpperCase() === time.toUpperCase() ||
                trimmedText.toLowerCase() === time.toLowerCase() ||
                timesMatch(trimmedText, time)) {
              await button.click();
              slotClicked = true;
              console.log(`✅ Clicked time slot button by text: ${trimmedText} (matched ${time})`);
              break;
            }
          } catch (error) {
            continue;
          }
        }
      }

      if (!slotClicked) {
        console.error(`❌ [BOOK-SLOT] Time slot button NOT FOUND`);
        // Get available slots one more time for error message
        let availableSlotInfo = '';
        try {
          const slots = await page.$$eval('[data-id="calendar-slot"], button[data-test-id^="slot-"]',
            (buttons: Element[]) => buttons.map((b: Element) => b.textContent?.trim()).filter(Boolean) as string[]
          );
          console.error(`📋 [BOOK-SLOT] Available slots on page: ${slots.join(', ')}`);
          availableSlotInfo = ` Available slots: ${slots.join(', ')}`;
        } catch {}

        throw new Error(`Time slot button not found for time ${time} (formatted: ${slotTimeId}).${availableSlotInfo}`);
      }

      console.log(`✅ [BOOK-SLOT] Time slot clicked successfully`);
      console.log(`⏳ [BOOK-SLOT] Waiting for booking to be processed...`);

      // Wait a moment to ensure booking is processed
      await page.waitForTimeout(1000);

      console.log(`🧹 [BOOK-SLOT] Cleaning up browser instance...`);
      // Close instance after successful booking
      await browserInstanceManager.cleanupInstance(email);
      console.log(`✅ [BOOK-SLOT] Browser instance cleaned up`);

      return { success: true, date, time };
    }, 30000); // 30 second timeout for booking

    const bookingDuration = Date.now() - bookingStartTime;
    console.log(`⏱️ [BOOK-SLOT] Booking duration: ${bookingDuration}ms`);

    const responseTime = Date.now() - requestStartTime;

    // Format dateTime in the same format as get-slots: "Wednesday, January 22, 2026 at 10:30 AM IST"
    const formatDateTime = (dateStr: string, timeStr: string, tz?: string): string => {
      try {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];

        // Get timezone abbreviation
        let tzAbbr = '';
        if (tz) {
          const tzMap: Record<string, string> = {
            'Asia/Jerusalem': 'IST',
            'America/New_York': 'EST',
            'America/Chicago': 'CST',
            'America/Denver': 'MST',
            'America/Los_Angeles': 'PST',
            'Europe/London': 'GMT',
            'Europe/Paris': 'CET',
            'UTC': 'UTC',
            'GMT': 'GMT',
          };
          tzAbbr = tzMap[tz] || tz.split('/').pop()?.toUpperCase() || '';
        }

        const formatted = `${dayNames[date.getDay()]}, ${monthNames[month - 1]} ${day}, ${year} at ${timeStr}`;
        return tzAbbr ? `${formatted} ${tzAbbr}` : formatted;
      } catch (error) {
        return `${dateStr} at ${timeStr}`;
      }
    };

    console.log("\n───────────────────────────────────────────────────────");
    console.log("✅ [BOOK-SLOT] ===== BOOKING SUCCESSFUL =====");
    console.log("───────────────────────────────────────────────────────");
    console.log(`📅 [BOOK-SLOT] Booked Date: ${result.date}`);
    console.log(`⏰ [BOOK-SLOT] Booked Time: ${result.time}`);
    console.log(`⏱️ [BOOK-SLOT] Total response time: ${responseTime}ms`);

    const successResponse = ErrorHandler.createSuccess(
      SuccessCode.OPERATION_SUCCESS,
      {
        message: 'Slot booked successfully',
        date: result.date,
        time: result.time,
        dateTime: formatDateTime(result.date, result.time, timezone),
      },
      requestId,
      responseTime
    );

    console.log(`📤 [BOOK-SLOT] Sending success response`);
    console.log("═══════════════════════════════════════════════════════\n");

    const response = NextResponse.json(
      successResponse,
      { status: ErrorHandler.getSuccessStatusCode() }
    );
    return security.addSecurityHeaders(response);

  } catch (error: any) {
    console.log("\n═══════════════════════════════════════════════════════");
    console.error("❌ [BOOK-SLOT] ===== BOOKING ERROR =====");
    console.log("═══════════════════════════════════════════════════════");
    console.error(`💥 [BOOK-SLOT] Error type: ${error?.constructor?.name || "Unknown"}`);
    console.error(`💥 [BOOK-SLOT] Error message: ${error?.message || "No message"}`);
    console.error(`💥 [BOOK-SLOT] Error stack:`, error?.stack);
    console.error(`📋 [BOOK-SLOT] Request ID: ${requestId}`);

    const responseTime = Date.now() - requestStartTime;

    // Handle queue timeout errors
    if (error.message && error.message.includes('timeout')) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.REQUEST_TIMEOUT,
        'Booking timed out',
        'Request timed out while waiting in queue or during execution. Please try again.',
        { queueStatus: concurrencyManager.getStatus(), originalError: error.message },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 504 }
      );
      return security.addSecurityHeaders(response);
    }

    // Handle queue full errors
    if (error.message && error.message.includes('queue is full')) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.QUEUE_FULL,
        'Request queue is full',
        'The system is currently processing too many requests. Please try again later.',
        { queueStatus: concurrencyManager.getStatus(), originalError: error.message },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 503 }
      );
      return security.addSecurityHeaders(response);
    }

    // Handle slot not found errors
    if (error.message && (error.message.includes('Time slot button not found') || error.message.includes('Time slot not found'))) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.SLOT_NOT_FOUND,
        'Time slot not found',
        'The requested time slot could not be found on the calendar. The slot may have been booked by another user, or the time format may not match.',
        { originalError: error.message },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 500 }
      );
      return security.addSecurityHeaders(response);
    }

    // Handle day button not found errors
    if (error.message && (error.message.includes('Day button not found') || error.message.includes('day button not found'))) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.DAY_BUTTON_NOT_FOUND,
        'Day button not found',
        'The requested date could not be found on the calendar. The date may be outside the available range or the calendar may not have loaded correctly.',
        { originalError: error.message },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 500 }
      );
      return security.addSecurityHeaders(response);
    }

    // Generic error
    const errorResponse = ErrorHandler.parseError(error, requestId, responseTime);
    const response = NextResponse.json(
      errorResponse,
      { status: ErrorHandler.getStatusCode(errorResponse.code) }
    );

    return security.addSecurityHeaders(response);
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return security.configureCORS(response);
}

