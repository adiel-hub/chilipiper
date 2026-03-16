import { NextRequest, NextResponse } from "next/server";
import {
  SecurityMiddleware,
  ValidationSchemas,
} from "@/lib/security-middleware";
import { concurrencyManager } from "@/lib/concurrency-manager";
import { ErrorHandler, ErrorCode, SuccessCode } from "@/lib/error-handler";
// Dynamic import to avoid bundling Playwright during build
// Note: timezone-utils no longer needed - Playwright emulates user's timezone directly

const security = new SecurityMiddleware();

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now(); // Start timing from the very beginning
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("🔍 [GET-SLOTS] ===== NEW REQUEST RECEIVED =====");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`📋 [GET-SLOTS] Request ID: ${requestId}`);
    console.log(`⏰ [GET-SLOTS] Timestamp: ${new Date().toISOString()}`);
    console.log(`🌐 [GET-SLOTS] Request URL: ${request.url}`);
    console.log(`🔤 [GET-SLOTS] Method: ${request.method}`);
    console.log(`📍 [GET-SLOTS] Client IP: ${request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"}`);
    console.log(`🤖 [GET-SLOTS] User Agent: ${request.headers.get("user-agent") || "unknown"}`);
    console.log(`🔑 [GET-SLOTS] Authorization: ${request.headers.get("authorization") ? "Present" : "None"}`);
    console.log(`🔑 [GET-SLOTS] X-API-Key: ${request.headers.get("x-api-key") ? "Present" : "None"}`);

    // Log raw request body for debugging
    try {
      const clonedRequest = request.clone();
      const rawBody = await clonedRequest.text();
      console.log(`📦 [GET-SLOTS] Raw Request Body (${rawBody.length} bytes):`);
      console.log(rawBody);
    } catch (e) {
      console.log(`⚠️ [GET-SLOTS] Could not log raw body: ${e}`);
    }

    // Apply security middleware (no auth required - public API)
    console.log(`🔒 [GET-SLOTS] Applying security middleware...`);
    const securityResult = await security.secureRequest(request, {
      requireAuth: false, // Public API - no authentication required
      rateLimit: { maxRequests: 150, windowMs: 15 * 60 * 1000 }, // 150 requests per 15 minutes
      inputSchema: ValidationSchemas.scrapeRequest,
      allowedMethods: ["POST"],
    });

    if (!securityResult.allowed) {
      console.error("❌ [GET-SLOTS] Security check FAILED:", JSON.stringify(securityResult.response));
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.UNAUTHORIZED,
        "Request blocked by security middleware",
        securityResult.response?.statusText ||
          "Authentication or validation failed",
        undefined,
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, {
        status: ErrorHandler.getStatusCode(errorResponse.code),
      });
      return security.addSecurityHeaders(response);
    }

    const body = securityResult.sanitizedData!;
    console.log(`✅ [GET-SLOTS] Security check PASSED`);
    console.log(`📋 [GET-SLOTS] Parsed and validated data:`, JSON.stringify(body, null, 2));

    // Extract contact fields from custom_params if not provided at top level
    // This supports platforms that send contact info nested in custom_params
    let firstName = body.first_name || "";
    let lastName = body.last_name || "";
    let email = body.email || "";
    let phone = body.phone || "";

    console.log(`👤 [GET-SLOTS] Contact fields BEFORE extraction:`);
    console.log(`   - First Name: "${firstName}"`);
    console.log(`   - Last Name: "${lastName}"`);
    console.log(`   - Email: "${email}"`);
    console.log(`   - Phone: "${phone}"`);

    if (body.custom_params && typeof body.custom_params === "object") {
      console.log(`🔍 [GET-SLOTS] Extracting from custom_params:`, JSON.stringify(body.custom_params));
      const params = body.custom_params as Record<string, any>;
      firstName = firstName || params.firstname || params.first_name || "";
      lastName = lastName || params.lastname || params.last_name || "";
      phone = phone || params.phone || params.phone_number || "";
      email = email || params.email || "";
    }

    console.log(`👤 [GET-SLOTS] Contact fields AFTER extraction:`);
    console.log(`   - First Name: "${firstName}"`);
    console.log(`   - Last Name: "${lastName}"`);
    console.log(`   - Email: "${email}"`);
    console.log(`   - Phone: "${phone}"`)

    // Record API usage
    const clientIP =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    // Extract optional configuration from request body (overrides env vars)
    const chiliPiperUrl = body.chili_piper_url || undefined;
    const requestedDays = body.max_days
      ? parseInt(body.max_days.toString(), 10)
      : undefined;
    const maxSlotsPerDay = body.max_slots_per_day
      ? parseInt(body.max_slots_per_day.toString(), 10)
      : undefined;
    const maxSlots = body.max_slots
      ? parseInt(body.max_slots.toString(), 10)
      : undefined; // Limit total slots returned
    const userTimezone = body.timezone || undefined; // User's timezone for conversion
    const startDate = body.start_date || undefined; // Filter: only include slots from this date (YYYY-MM-DD)
    const endDate = body.end_date || undefined; // Filter: only include slots up to this date (YYYY-MM-DD)

    // Validate max_days if provided
    if (requestedDays && (requestedDays < 1 || requestedDays > 30)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid max_days parameter",
        "max_days parameter must be between 1 and 30",
        { providedValue: requestedDays },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    // Validate max_slots_per_day if provided
    if (maxSlotsPerDay && (maxSlotsPerDay < 1 || maxSlotsPerDay > 50)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid max_slots_per_day parameter",
        "max_slots_per_day parameter must be between 1 and 50",
        { providedValue: maxSlotsPerDay },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    // Validate max_slots if provided
    if (maxSlots && (maxSlots < 1 || maxSlots > 100)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid max_slots parameter",
        "max_slots parameter must be between 1 and 100",
        { providedValue: maxSlots },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    // Validate start_date format if provided (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !dateRegex.test(startDate)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid start_date format",
        'start_date must be in YYYY-MM-DD format (e.g., "2026-01-22")',
        { providedValue: startDate },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    // Validate end_date format if provided (YYYY-MM-DD)
    if (endDate && !dateRegex.test(endDate)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid end_date format",
        'end_date must be in YYYY-MM-DD format (e.g., "2026-01-22")',
        { providedValue: endDate },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    // Validate that end_date is not before start_date
    if (startDate && endDate && startDate > endDate) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        "Invalid date range",
        "end_date cannot be before start_date",
        { startDate, endDate },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 400 });
      return security.addSecurityHeaders(response);
    }

    console.log("\n───────────────────────────────────────────────────────");
    console.log("🔍 [GET-SLOTS] ===== STARTING SCRAPING PROCESS =====");
    console.log("───────────────────────────────────────────────────────");
    console.log(`🔗 [GET-SLOTS] Chili Piper URL: ${chiliPiperUrl || "NOT PROVIDED"}`);
    console.log(`📅 [GET-SLOTS] Requested Days: ${requestedDays || "DEFAULT (from env)"}`);
    console.log(`🎰 [GET-SLOTS] Max Slots Per Day: ${maxSlotsPerDay || "DEFAULT (from env)"}`);
    console.log(`🔢 [GET-SLOTS] Max Total Slots: ${maxSlots || "UNLIMITED"}`);
    console.log(`📆 [GET-SLOTS] Start Date Filter: ${startDate || "NONE"}`);
    console.log(`📆 [GET-SLOTS] End Date Filter: ${endDate || "NONE"}`);
    console.log(`🕐 [GET-SLOTS] User Timezone: ${userTimezone || "DEFAULT (America/Chicago)"}`);
    console.log(`👤 [GET-SLOTS] Contact Info: ${firstName} ${lastName} <${email}> ${phone}`);

    if (body.custom_params) {
      console.log(`📦 [GET-SLOTS] Custom Params:`, JSON.stringify(body.custom_params, null, 2));
    }

    // Get concurrency status for logging
    const concurrencyStatus = concurrencyManager.getStatus();
    console.log(`🚦 [GET-SLOTS] Concurrency Status:`);
    console.log(`   - Active: ${concurrencyStatus.active}/${concurrencyStatus.capacity}`);
    console.log(`   - Queued: ${concurrencyStatus.queued}`);
    console.log(`   - Queue Size: ${concurrencyStatus.queueSize}`);
    console.log("───────────────────────────────────────────────────────\n");

    // Run the scraping through concurrency manager (dynamic import to avoid bundling Playwright)
    // Pass userTimezone to scraper - Playwright will emulate this timezone so Chili Piper displays times directly in user's timezone
    console.log(`🚀 [GET-SLOTS] Executing scraping task...`);
    const scrapingStartTime = Date.now();

    const result = await concurrencyManager.execute(async () => {
      console.log(`📦 [GET-SLOTS] Importing ChiliPiperScraper...`);
      const { ChiliPiperScraper } = await import("@/lib/scraper");
      console.log(`✅ [GET-SLOTS] ChiliPiperScraper imported successfully`);

      console.log(`🏗️ [GET-SLOTS] Creating scraper instance with URL: ${chiliPiperUrl}`);
      const scraper = new ChiliPiperScraper(chiliPiperUrl);

      console.log(`🎬 [GET-SLOTS] Starting scraper.scrapeSlots()...`);
      const scrapingResult = await scraper.scrapeSlots(
        firstName,
        lastName,
        email,
        phone,
        undefined, // onDayComplete callback
        requestedDays, // maxDays parameter
        maxSlotsPerDay, // maxSlotsPerDay parameter
        body.custom_params, // custom form parameters
        userTimezone, // User's timezone - browser will emulate this timezone
        maxSlots, // maxTotalSlots - stop scraping early when this limit is reached
        startDate, // Filter: only include slots from this date
        endDate, // Filter: only include slots up to this date
      );

      console.log(`🏁 [GET-SLOTS] scraper.scrapeSlots() completed`);
      console.log(`📊 [GET-SLOTS] Scraping result success: ${scrapingResult.success}`);
      if (scrapingResult.data) {
        console.log(`📊 [GET-SLOTS] Days found: ${scrapingResult.data.total_days}`);
        console.log(`📊 [GET-SLOTS] Slots found: ${scrapingResult.data.total_slots}`);
      }

      return scrapingResult;
    }, 60000); // 60 second timeout for scraping operation

    const scrapingDuration = Date.now() - scrapingStartTime;
    console.log(`⏱️ [GET-SLOTS] Scraping duration: ${scrapingDuration}ms`);

    if (!result.success) {
      console.log(`❌ [GET-SLOTS] Scraping FAILED: ${result.error}`);

      // Record failed usage
      const responseTime = Date.now() - requestStartTime;
      security.logSecurityEvent(
        "SCRAPING_FAILED",
        {
          endpoint: "/api/get-slots",
          userAgent,
          responseTime,
          error: result.error,
        },
        clientIP,
      );

      const errorResponse = ErrorHandler.parseError(
        result.error,
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, {
        status: ErrorHandler.getStatusCode(errorResponse.code),
      });

      return security.addSecurityHeaders(response);
    }

    console.log("\n───────────────────────────────────────────────────────");
    console.log("✅ [GET-SLOTS] ===== SCRAPING COMPLETED SUCCESSFULLY =====");
    console.log("───────────────────────────────────────────────────────");
    console.log(`📊 [GET-SLOTS] Days found: ${result.data?.total_days}`);
    console.log(`📊 [GET-SLOTS] Slots found: ${result.data?.total_slots}`);
    console.log(`🕐 [GET-SLOTS] Calendar timezone: ${result.data?.calendar_timezone}`);

    // Times are already in user's timezone (Playwright emulates the user's timezone)
    // Just add timezone info to the response
    let responseData: any = result.data;

    // Apply max_slots limit if specified
    if (
      maxSlots &&
      responseData &&
      responseData.slots &&
      responseData.slots.length > maxSlots
    ) {
      console.log(
        `🔢 [GET-SLOTS] Limiting slots from ${responseData.slots.length} to ${maxSlots}`,
      );
      responseData = {
        ...responseData,
        slots: responseData.slots.slice(0, maxSlots),
        total_slots: maxSlots,
      };
    }

    if (userTimezone && responseData) {
      responseData = {
        ...responseData,
        timezone: userTimezone, // The timezone the times are displayed in
      };
      console.log(`🕐 [GET-SLOTS] Times displayed in timezone: ${userTimezone}`);
    }

    // Log first few slots for verification
    if (responseData?.slots && responseData.slots.length > 0) {
      console.log(`📋 [GET-SLOTS] First 3 slots:`);
      responseData.slots.slice(0, 3).forEach((slot: any, idx: number) => {
        console.log(`   ${idx + 1}. ${slot.dateTime || `${slot.date} ${slot.time}`}`);
      });
    }

    // Record successful usage
    const responseTime = Date.now() - requestStartTime;
    console.log(`⏱️ [GET-SLOTS] Total response time: ${responseTime}ms`);

    security.logSecurityEvent(
      "SCRAPING_SUCCESS",
      {
        endpoint: "/api/get-slots",
        userAgent,
        responseTime,
        daysFound: responseData?.total_days,
        slotsFound: responseData?.total_slots,
      },
      clientIP,
    );

    // Create structured success response with code
    const successResponse = ErrorHandler.createSuccess(
      SuccessCode.SCRAPING_SUCCESS,
      responseData,
      requestId,
      responseTime,
    );

    console.log(`📤 [GET-SLOTS] Sending success response`);
    console.log(`📦 [GET-SLOTS] Response size: ${JSON.stringify(successResponse).length} bytes`);
    console.log("═══════════════════════════════════════════════════════\n");

    const response = NextResponse.json(successResponse, {
      status: ErrorHandler.getSuccessStatusCode(),
    });
    return security.addSecurityHeaders(response);
  } catch (error: any) {
    console.log("\n═══════════════════════════════════════════════════════");
    console.error("❌ [GET-SLOTS] ===== API ERROR =====");
    console.log("═══════════════════════════════════════════════════════");
    console.error(`💥 [GET-SLOTS] Error type: ${error?.constructor?.name || "Unknown"}`);
    console.error(`💥 [GET-SLOTS] Error message: ${error?.message || "No message"}`);
    console.error(`💥 [GET-SLOTS] Error stack:`, error?.stack);
    console.error(`📋 [GET-SLOTS] Request ID: ${requestId}`);

    const responseTime = Date.now() - requestStartTime;
    console.log(`⏱️ [GET-SLOTS] Time before error: ${responseTime}ms`);

    // Handle queue timeout errors
    if (error.message && error.message.includes("timeout")) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.REQUEST_TIMEOUT,
        "Request timed out",
        "Request timed out while waiting in queue or during execution. Please try again.",
        {
          queueStatus: concurrencyManager.getStatus(),
          originalError: error.message,
        },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 504 });
      return security.addSecurityHeaders(response);
    }

    // Handle queue full errors
    if (error.message && error.message.includes("queue is full")) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.QUEUE_FULL,
        "Request queue is full",
        "The system is currently processing too many requests. Please try again later.",
        {
          queueStatus: concurrencyManager.getStatus(),
          originalError: error.message,
        },
        requestId,
        responseTime,
      );
      const response = NextResponse.json(errorResponse, { status: 503 });
      return security.addSecurityHeaders(response);
    }

    // Generic error
    const errorResponse = ErrorHandler.parseError(
      error,
      requestId,
      responseTime,
    );
    const response = NextResponse.json(errorResponse, {
      status: ErrorHandler.getStatusCode(errorResponse.code),
    });

    return security.addSecurityHeaders(response);
  }
}

export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 200 });
  return security.configureCORS(response);
}
