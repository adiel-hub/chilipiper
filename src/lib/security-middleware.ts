// Lightweight, framework-agnostic helpers for security

// API key validation - all keys must come from environment variables
// Never hardcode API keys in source code
const getApiKeys = (): Set<string> => {
  const keys = new Set<string>();
  
  // Only use environment variables - no hardcoded keys
  if (process.env.DEFAULT_API_KEY) {
    keys.add(process.env.DEFAULT_API_KEY);
  }
  
  if (process.env.API_KEYS) {
    process.env.API_KEYS.split(',').forEach(key => {
      const trimmed = key.trim();
      if (trimmed) keys.add(trimmed);
    });
  }
  
  return keys;
};

export interface SecurityConfig {
  maxRequests?: number;
  windowMs?: number;
  skipSuccessfulRequests?: boolean;
}

export class SecurityMiddleware {
  // Rate limiting store (simple in-memory for local testing)
  private rateLimitMap = new Map<string, { count: number; resetTime: number }>();

  // Rate limiting middleware
  checkRateLimit(ip: string, config: SecurityConfig = {}): boolean {
    const maxRequests = config.maxRequests || 100; // Default: 100 requests
    const windowMs = config.windowMs || 15 * 60 * 1000; // Default: 15 minutes
    
    const now = Date.now();
    const limit = this.rateLimitMap.get(ip);
    
    if (!limit || now > limit.resetTime) {
      this.rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return true;
    }
    
    if (limit.count >= maxRequests) {
      return false;
    }
    
    limit.count++;
    return true;
  }

  // Input validation and sanitization
  validateInput(data: any, schema: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      const typedRules = rules as any;
      
      if (typedRules.required && (!value || value.toString().trim() === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value) {
        // String validation
        if (typedRules.type === 'string') {
          if (typeof value !== 'string') {
            errors.push(`${field} must be a string`);
            continue;
          }
          
          if (typedRules.minLength && value.length < typedRules.minLength) {
            errors.push(`${field} must be at least ${typedRules.minLength} characters`);
          }
          
          if (typedRules.maxLength && value.length > typedRules.maxLength) {
            errors.push(`${field} must be no more than ${typedRules.maxLength} characters`);
          }
          
          if (typedRules.pattern && !typedRules.pattern.test(value)) {
            errors.push(`${field} format is invalid`);
          }
        }

        // Email validation
        if (typedRules.type === 'email') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push(`${field} must be a valid email address`);
          }
        }

        // Phone validation
        if (typedRules.type === 'phone') {
          const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
          if (!phoneRegex.test(value.replace(/[\s\-\(\)]/g, ''))) {
            errors.push(`${field} must be a valid phone number`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Sanitize input data
  sanitizeInput(data: any): any {
    const sanitized: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Remove potentially dangerous characters
        sanitized[key] = value
          .replace(/[<>]/g, '') // Remove < and >
          .replace(/javascript:/gi, '') // Remove javascript: protocol
          .replace(/on\w+=/gi, '') // Remove event handlers
          .trim();
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  // API key validation (supports both Authorization: Bearer and X-API-Key headers)
  validateApiKey(authHeader: string, xApiKey?: string): { valid: boolean; apiKey?: any } {
    let token: string | null = null;
    
    // Try Authorization header first (Bearer token)
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }
    // Fallback to X-API-Key header
    else if (xApiKey) {
      token = xApiKey.trim();
    }
    
    if (!token) {
      return { valid: false };
    }
    
    // Get API keys from environment variables only (no hardcoded keys)
    const validKeys = getApiKeys();
    const isValid = validKeys.has(token);
    
    // Log validation attempt (without exposing the token)
    if (!isValid) {
      console.log('❌ Invalid API key attempt');
    }
    
    return { valid: isValid, apiKey: isValid ? { key: token } : undefined };
  }

  // Security headers helper (works with Node/HTTP response-like objects and Next.js Response)
  addSecurityHeaders(res: any): any {
    // Check if it's a Next.js Response object
    if (res instanceof Response || res.headers) {
      const headers = new Headers(res.headers);
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');
      headers.set('X-XSS-Protection', '1; mode=block');
      headers.set('Content-Security-Policy', "default-src 'self'");
      
      // Return new Response with headers if it's a Response object
      if (res instanceof Response) {
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: headers
        });
      }
      
      // For NextResponse, update headers
      res.headers = headers;
      return res;
    }
    
    // For Node.js HTTP response objects
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    
    // Remove server information
    try { res.removeHeader && res.removeHeader('X-Powered-By'); } catch {}
    return res;
  }

  // CORS configuration helper
  configureCORS(res: any, allowedOrigins: string[] = ['*']): void {
    const origin = process.env.NODE_ENV === 'production' ? 
      allowedOrigins.join(', ') : '*';
    
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  // Log security events
  logSecurityEvent(event: string, details: any, ip: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[SECURITY] ${timestamp} - ${event}`, {
      ip,
      userAgent: details.userAgent,
      endpoint: details.endpoint,
      ...details
    });
  }

  // Framework-agnostic middleware factory (kept for compatibility; not used in Fastify path)
  secureRequestMiddleware(config: {
    requireAuth?: boolean;
    rateLimit?: SecurityConfig;
    inputSchema?: any;
    allowedMethods?: string[];
  } = {}) {
    return async (req: any, res: any, next: () => void) => {
      const clientIP = req.headers['x-forwarded-for']?.toString().split(',')[0] || 
                      req.headers['x-real-ip']?.toString() || 
                      req.ip ||
                      'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';
      const method = req.method;

      // Check allowed methods
      if (config.allowedMethods && !config.allowedMethods.includes(method)) {
        this.logSecurityEvent('METHOD_NOT_ALLOWED', { method, endpoint: req.url }, clientIP);
        res.status(405).json({ success: false, error: 'Method Not Allowed' });
        return;
      }

      // Rate limiting
      if (config.rateLimit && !this.checkRateLimit(clientIP, config.rateLimit)) {
        this.logSecurityEvent('RATE_LIMIT_EXCEEDED', { 
          endpoint: req.url,
          userAgent 
        }, clientIP);
        
        res.status(429)
          .setHeader('Retry-After', '900')
          .json({ success: false, error: 'Too Many Requests' });
        return;
      }

      // Authentication check
      if (config.requireAuth) {
        const authHeader = req.headers.authorization || '';
        const xApiKey = req.headers['x-api-key'] || '';
        const authResult = this.validateApiKey(authHeader, xApiKey);
        
        if (!authResult.valid) {
          this.logSecurityEvent('AUTH_FAILED', { 
            endpoint: req.url,
            userAgent 
          }, clientIP);
          
          res.status(401).json({
            success: false,
            error: 'Unauthorized',
            message: 'Invalid or missing API key. Use Authorization: Bearer <key> or X-API-Key: <key> header'
          });
          return;
        }
        
        // Attach API key to request for later use
        (req as any).apiKey = authResult.apiKey;
      }

      // Input validation for POST requests
      if (method === 'POST' && config.inputSchema) {
        const sanitized = this.sanitizeInput(req.body);
        const validation = this.validateInput(sanitized, config.inputSchema);
        
        if (!validation.valid) {
          this.logSecurityEvent('VALIDATION_FAILED', { 
            endpoint: req.url,
            errors: validation.errors,
            userAgent 
          }, clientIP);
          
          res.status(400).json({
            success: false,
            error: 'Validation Error',
            message: validation.errors.join(', ')
          });
          return;
        }
        
        // Replace body with sanitized data
        req.body = sanitized;
      }

      // Add security headers
      this.addSecurityHeaders(res);
      this.configureCORS(res);

      next();
    };
  }

  // Next.js-specific secureRequest method
  async secureRequest(
    request: any,
    config: {
      requireAuth?: boolean;
      rateLimit?: SecurityConfig;
      inputSchema?: any;
      allowedMethods?: string[];
    } = {}
  ): Promise<{
    allowed: boolean;
    response?: any;
    sanitizedData?: any;
  }> {
    // Import NextResponse dynamically to avoid issues if not available
    const { NextResponse } = await import('next/server');
    
    console.error('🚀 secureRequest called:', {
      url: request.url,
      method: request.method,
      requireAuth: config.requireAuth,
      hasHeaders: !!request.headers
    });
    
    const clientIP = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const method = request.method;

    // Check allowed methods
    if (config.allowedMethods && !config.allowedMethods.includes(method)) {
      this.logSecurityEvent('METHOD_NOT_ALLOWED', { method, endpoint: request.url }, clientIP);
      const response = NextResponse.json(
        { success: false, error: 'Method Not Allowed' },
        { status: 405 }
      );
      this.addSecurityHeaders(response);
      return { allowed: false, response };
    }

    // Rate limiting
    if (config.rateLimit && !this.checkRateLimit(clientIP, config.rateLimit)) {
      this.logSecurityEvent('RATE_LIMIT_EXCEEDED', { 
        endpoint: request.url,
        userAgent 
      }, clientIP);
      
      const response = NextResponse.json(
        { success: false, error: 'Too Many Requests' },
        { 
          status: 429,
          headers: { 'Retry-After': '900' }
        }
      );
      this.addSecurityHeaders(response);
      return { allowed: false, response };
    }

    // Authentication check
    if (config.requireAuth) {
      // Next.js headers.get() is case-insensitive, but let's be explicit
      const authHeader = request.headers.get('authorization') || '';
      // Try both lowercase and the exact case
      const xApiKey = request.headers.get('x-api-key') || 
                     request.headers.get('X-API-Key') || '';
      
      // Debug logging - log to stderr so it shows up in PM2 logs
      const allHeaders: [string, string][] = Array.from(request.headers.entries()) as [string, string][];
      const relevantHeaders = allHeaders.filter(([k]) => 
        k.toLowerCase().includes('api') || k.toLowerCase().includes('auth')
      );
      console.error('🔐 Auth check:', JSON.stringify({
        hasAuthHeader: !!authHeader,
        authHeaderPrefix: authHeader.substring(0, 20),
        hasXApiKey: !!xApiKey,
        xApiKeyPrefix: xApiKey.substring(0, 20),
        xApiKeyFull: xApiKey,
        relevantHeaders,
        allHeaderKeys: allHeaders.map(([k]) => k)
      }));
      
      const authResult = this.validateApiKey(authHeader, xApiKey);
      
      console.error('🔐 Auth result:', JSON.stringify({ valid: authResult.valid }));
      
      if (!authResult.valid) {
        this.logSecurityEvent('AUTH_FAILED', { 
          endpoint: request.url,
          userAgent 
        }, clientIP);
        
        const response = NextResponse.json(
          {
            success: false,
            error: 'Unauthorized',
            message: 'Invalid or missing API key. Use Authorization: Bearer <key> or X-API-Key: <key> header'
          },
          { status: 401 }
        );
        this.addSecurityHeaders(response);
        return { allowed: false, response };
      }
    }

    // Parse and validate input for POST requests
    let sanitizedData: any = null;
    if (method === 'POST' && config.inputSchema) {
      try {
        const body = await request.json();
        sanitizedData = this.sanitizeInput(body);
        const validation = this.validateInput(sanitizedData, config.inputSchema);
        
        if (!validation.valid) {
          this.logSecurityEvent('VALIDATION_FAILED', { 
            endpoint: request.url,
            errors: validation.errors,
            userAgent 
          }, clientIP);
          
          const response = NextResponse.json(
            {
              success: false,
              error: 'Validation Error',
              message: validation.errors.join(', ')
            },
            { status: 400 }
          );
          this.addSecurityHeaders(response);
          return { allowed: false, response };
        }
      } catch (error) {
        const response = NextResponse.json(
          {
            success: false,
            error: 'Invalid JSON',
            message: 'Request body must be valid JSON'
          },
          { status: 400 }
        );
        this.addSecurityHeaders(response);
        return { allowed: false, response };
      }
    }

    return { allowed: true, sanitizedData };
  }
}

// Input validation schemas
export const ValidationSchemas = {
  scrapeRequest: {
    // Person fields - all optional (use what your Chili Piper form requires)
    first_name: { type: 'string', required: false, maxLength: 100 },
    last_name: { type: 'string', required: false, maxLength: 100 },
    email: { type: 'string', required: false, maxLength: 255 },
    phone: { type: 'string', required: false, maxLength: 20 },
    // Custom parameters for Chili Piper form (any additional fields)
    custom_params: { type: 'object', required: false },
    // Required API-level configuration (no env fallback)
    chili_piper_url: { type: 'string', required: true, minLength: 10, maxLength: 500 },
    max_days: { type: 'string', required: true },
    max_slots_per_day: { type: 'string', required: true },
    // Timezone support - convert slot times to user's timezone
    timezone: { type: 'string', required: false, maxLength: 50 } // User's timezone (e.g., "America/New_York", "EST", "Asia/Jerusalem")
  },
  
  adminLogin: {
    username: { type: 'string', required: true, minLength: 3, maxLength: 50 },
    password: { type: 'string', required: true, minLength: 8, maxLength: 128 }
  },
  
  apiKeyCreate: {
    name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    description: { type: 'string', required: false, maxLength: 500 },
    customKey: { type: 'string', required: false, maxLength: 200 }
  }
};
