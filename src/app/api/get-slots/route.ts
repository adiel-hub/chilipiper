import { NextRequest, NextResponse } from 'next/server';
import { SecurityMiddleware, ValidationSchemas } from '@/lib/security-middleware';
import { concurrencyManager } from '@/lib/concurrency-manager';
import { ErrorHandler, ErrorCode, SuccessCode } from '@/lib/error-handler';
// Dynamic import to avoid bundling Playwright during build
// Note: timezone-utils no longer needed - Playwright emulates user's timezone directly

const security = new SecurityMiddleware();

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now(); // Start timing from the very beginning
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Log all headers for debugging
    const allHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      allHeaders[key] = value;
    });
    console.error('📋 Get-Slots API - All headers:', JSON.stringify(allHeaders));
    console.error('📋 Get-Slots API - X-API-Key header:', request.headers.get('x-api-key') || request.headers.get('X-API-Key') || 'NOT FOUND');
    
    console.log('🔍 Get-Slots API Debug - Request received');
    
    // Apply security middleware
    const securityResult = await security.secureRequest(request, {
      requireAuth: true,
      rateLimit: { maxRequests: 50, windowMs: 15 * 60 * 1000 }, // 50 requests per 15 minutes
      inputSchema: ValidationSchemas.scrapeRequest,
      allowedMethods: ['POST']
    });

    if (!securityResult.allowed) {
      console.error('❌ Security check failed:', securityResult.response);
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
    console.log(`✅ Parsed and validated data:`, body);

    // Record API usage
    const clientIP = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Extract optional configuration from request body (overrides env vars)
    const chiliPiperUrl = body.chili_piper_url || undefined;
    const requestedDays = body.max_days ? parseInt(body.max_days.toString(), 10) : undefined;
    const maxSlotsPerDay = body.max_slots_per_day ? parseInt(body.max_slots_per_day.toString(), 10) : undefined;
    const userTimezone = body.timezone || undefined; // User's timezone for conversion

    // Validate max_days if provided
    if (requestedDays && (requestedDays < 1 || requestedDays > 30)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid max_days parameter',
        'max_days parameter must be between 1 and 30',
        { providedValue: requestedDays },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 400 }
      );
      return security.addSecurityHeaders(response);
    }

    // Validate max_slots_per_day if provided
    if (maxSlotsPerDay && (maxSlotsPerDay < 1 || maxSlotsPerDay > 50)) {
      const responseTime = Date.now() - requestStartTime;
      const errorResponse = ErrorHandler.createError(
        ErrorCode.VALIDATION_ERROR,
        'Invalid max_slots_per_day parameter',
        'max_slots_per_day parameter must be between 1 and 50',
        { providedValue: maxSlotsPerDay },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 400 }
      );
      return security.addSecurityHeaders(response);
    }

    console.log('🔍 Starting scraping process...');
    if (chiliPiperUrl) {
      console.log(`🔗 Using custom Chili Piper URL: ${chiliPiperUrl}`);
    }
    if (requestedDays) {
      console.log(`📅 Requested ${requestedDays} days`);
    }
    if (maxSlotsPerDay) {
      console.log(`🎰 Max ${maxSlotsPerDay} slots per day`);
    }
    if (userTimezone) {
      console.log(`🕐 User timezone: ${userTimezone} (browser will emulate this timezone)`);
    }

    // Get concurrency status for logging
    const concurrencyStatus = concurrencyManager.getStatus();
    console.log(`🚦 Concurrency status: ${concurrencyStatus.active}/${concurrencyStatus.capacity} active, ${concurrencyStatus.queued} queued`);

    // Run the scraping through concurrency manager (dynamic import to avoid bundling Playwright)
    // Pass userTimezone to scraper - Playwright will emulate this timezone so Chili Piper displays times directly in user's timezone
    const result = await concurrencyManager.execute(async () => {
      const { ChiliPiperScraper } = await import('@/lib/scraper');
      const scraper = new ChiliPiperScraper(chiliPiperUrl);
      return await scraper.scrapeSlots(
        body.first_name || '',
        body.last_name || '',
        body.email || '',
        body.phone || '',
        undefined, // onDayComplete callback
        requestedDays, // maxDays parameter
        maxSlotsPerDay, // maxSlotsPerDay parameter
        body.custom_params, // custom form parameters
        userTimezone // User's timezone - browser will emulate this timezone
      );
    }, 60000); // 60 second timeout for scraping operation
    
    if (!result.success) {
      console.log(`❌ Scraping failed: ${result.error}`);
      
      // Record failed usage
      const responseTime = Date.now() - requestStartTime;
      security.logSecurityEvent('SCRAPING_FAILED', {
        endpoint: '/api/get-slots',
        userAgent,
        responseTime,
        error: result.error
      }, clientIP);
      
      const errorResponse = ErrorHandler.parseError(result.error, requestId, responseTime);
      const response = NextResponse.json(
        errorResponse,
        { status: ErrorHandler.getStatusCode(errorResponse.code) }
      );
      
      return security.addSecurityHeaders(response);
    }
    
    console.log('✅ Scraping completed successfully');
    console.log(`📊 Result: ${result.data?.total_days} days, ${result.data?.total_slots} slots`);

    // Times are already in user's timezone (Playwright emulates the user's timezone)
    // Just add timezone info to the response
    let responseData: any = result.data;
    if (userTimezone && responseData) {
      responseData = {
        ...responseData,
        timezone: userTimezone, // The timezone the times are displayed in
      };
      console.log(`🕐 Times are displayed in user's timezone: ${userTimezone}`);
    }

    // Record successful usage
    const responseTime = Date.now() - requestStartTime;
    security.logSecurityEvent('SCRAPING_SUCCESS', {
      endpoint: '/api/get-slots',
      userAgent,
      responseTime,
      daysFound: responseData?.total_days,
      slotsFound: responseData?.total_slots
    }, clientIP);

    // Create structured success response with code
    const successResponse = ErrorHandler.createSuccess(
      SuccessCode.SCRAPING_SUCCESS,
      responseData,
      requestId,
      responseTime
    );
    
    const response = NextResponse.json(
      successResponse,
      { status: ErrorHandler.getSuccessStatusCode() }
    );
    return security.addSecurityHeaders(response);
    
  } catch (error: any) {
    console.error('❌ API error:', error);
    
    const responseTime = Date.now() - requestStartTime;
    
    // Handle queue timeout errors
    if (error.message && error.message.includes('timeout')) {
      const errorResponse = ErrorHandler.createError(
        ErrorCode.REQUEST_TIMEOUT,
        'Request timed out',
        'Request timed out while waiting in queue or during execution. Please try again.',
        { 
          queueStatus: concurrencyManager.getStatus(),
          originalError: error.message
        },
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
        { 
          queueStatus: concurrencyManager.getStatus(),
          originalError: error.message
        },
        requestId,
        responseTime
      );
      const response = NextResponse.json(
        errorResponse,
        { status: 503 }
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
