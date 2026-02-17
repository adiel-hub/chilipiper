# Debug Logging Enhancement

## Overview
Added comprehensive debug logging to help troubleshoot issues when Alta platform calls the API on Render.

## What Was Added

### 1. **GET-SLOTS Endpoint** (`/api/get-slots`)

#### Request Logging
- ✅ Request ID for tracing
- ✅ Timestamp
- ✅ Client IP address
- ✅ User Agent
- ✅ Authorization headers (presence check)
- ✅ Raw request body (full JSON)

#### Processing Logging
- ✅ Security middleware validation results
- ✅ Contact field extraction (before/after)
- ✅ Custom params extraction
- ✅ All scraping parameters (days, slots, timezone, filters)
- ✅ Concurrency status (active/queued tasks)

#### Scraping Logging
- ✅ Scraper initialization
- ✅ Browser instance creation
- ✅ Scraping duration
- ✅ Results (days found, slots found, timezone)
- ✅ First 3 slots preview
- ✅ Response size in bytes

#### Error Logging
- ✅ Error type and message
- ✅ Full stack trace
- ✅ Request ID for correlation
- ✅ Time before error

### 2. **BOOK-SLOT Endpoint** (`/api/book-slot`)

#### Request Logging
- ✅ Request ID for tracing
- ✅ Timestamp
- ✅ Client IP and User Agent
- ✅ Raw request body
- ✅ Parsed contact information
- ✅ Test mode detection

#### Booking Process Logging
- ✅ Browser instance lookup/creation
- ✅ Calendar page navigation
- ✅ Day button search and click
- ✅ Time slot search and click
- ✅ Available slots if booking fails
- ✅ Browser cleanup
- ✅ Booking duration

#### Success/Error Logging
- ✅ Booking confirmation
- ✅ Total response time
- ✅ Error details with stack trace

## Log Format

All logs follow this pattern:
```
[ENDPOINT] Message
```

For example:
- `🔍 [GET-SLOTS] ===== NEW REQUEST RECEIVED =====`
- `📅 [BOOK-SLOT] Looking for day buttons on calendar...`
- `❌ [GET-SLOTS] ===== API ERROR =====`

## Visual Separators

- Request start: `═══════════════` (double lines)
- Section breaks: `───────────────` (single lines)
- This makes logs easy to scan and find specific requests

## How to Use

### 1. **View Logs on Render**
```bash
# In Render dashboard:
1. Go to your service
2. Click "Logs" tab
3. Search for [GET-SLOTS] or [BOOK-SLOT]
4. Use Request ID to trace entire request lifecycle
```

### 2. **Filter by Request Type**
```bash
# Search in logs:
[GET-SLOTS]      # Only availability checks
[BOOK-SLOT]      # Only booking attempts
Request ID: req_ # Find specific request
```

### 3. **Common Issues to Look For**

#### Issue: Only 1 day found
Look for:
```
📅 [GET-SLOTS] Requested Days: X
📊 [GET-SLOTS] Days found: 1  ← Should match requested
```

#### Issue: Booking fails
Look for:
```
📋 [BOOK-SLOT] Available slots on page: ...
❌ [BOOK-SLOT] Time slot button NOT FOUND
```

#### Issue: Test mode activated
Look for:
```
🧪 [BOOK-SLOT] TEST MODE ACTIVATED - Email contains "test"
```

## Deployment

### Push to Render:
```bash
# Commit changes
git add .
git commit -m "Add comprehensive debug logging for Alta integration"
git push origin main

# Render will auto-deploy
# Check logs after deployment
```

### Environment Variable (Optional):
If you want to disable debug logging in production:
```bash
# Add to Render environment variables:
ENABLE_DEBUG_LOGS=false

# Then wrap logs with:
if (process.env.ENABLE_DEBUG_LOGS !== 'false') {
  console.log(...);
}
```

## Next Steps

1. **Deploy to Render** - Push these changes
2. **Test from Alta** - Make a real API call
3. **Check Render Logs** - Look for the detailed output
4. **Share Logs** - Send the log output from Render to debug any issues

## Example Log Output

```
═══════════════════════════════════════════════════════
🔍 [GET-SLOTS] ===== NEW REQUEST RECEIVED =====
═══════════════════════════════════════════════════════
📋 [GET-SLOTS] Request ID: req_1771256258057_abc123
⏰ [GET-SLOTS] Timestamp: 2026-02-17T15:37:38.058Z
🌐 [GET-SLOTS] Request URL: https://chilipiper.onrender.com/api/get-slots
📍 [GET-SLOTS] Client IP: 18.206.127.40
🤖 [GET-SLOTS] User Agent: axios/1.13.5
📦 [GET-SLOTS] Raw Request Body:
{"chili_piper_url":"https://...","email":"user@alta.com",...}
✅ [GET-SLOTS] Security check PASSED
───────────────────────────────────────────────────────
🔍 [GET-SLOTS] ===== STARTING SCRAPING PROCESS =====
───────────────────────────────────────────────────────
🔗 [GET-SLOTS] Chili Piper URL: https://canopytax...
📅 [GET-SLOTS] Requested Days: 3
🎰 [GET-SLOTS] Max Slots Per Day: 5
...
```
