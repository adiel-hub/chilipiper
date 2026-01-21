# Chili Piper API Documentation

Base URL: `https://chilipiper.onrender.com`

## Authentication

All API requests require an API key passed in the `X-API-Key` header.

```
X-API-Key: your_api_key_here
```

---

## Endpoints

### 1. Get Available Slots

Retrieves available meeting slots from a Chili Piper calendar.

**Endpoint:** `POST /api/get-slots`

#### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `X-API-Key` | Yes | Your API key |

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chili_piper_url` | string | **Yes** | The Chili Piper booking URL (e.g., `https://company.chilipiper.com/me/user/meeting-type`) |
| `max_days` | string | **Yes** | Maximum number of days to fetch (1-30) |
| `max_slots_per_day` | string | **Yes** | Maximum slots to return per day (1-50) |
| `max_slots` | string | No | Maximum total slots to return (1-100). Use this to limit the response to a specific number of slots, e.g., `"3"` to get only the first 3 available slots. |
| `start_date` | string | No | Only include slots from this date onwards (format: `YYYY-MM-DD`, e.g., `"2026-01-22"`). Use to filter for specific dates like "tomorrow". |
| `end_date` | string | No | Only include slots up to this date (format: `YYYY-MM-DD`, e.g., `"2026-01-22"`). Use with `start_date` to filter for a specific date range. |
| `timezone` | string | No | User's timezone in IANA format (e.g., `America/New_York`, `Asia/Jerusalem`). Times will be displayed in this timezone. |
| `first_name` | string | No | First name (if required by the Chili Piper form) |
| `last_name` | string | No | Last name (if required by the Chili Piper form) |
| `email` | string | No | Email address (if required by the Chili Piper form) |
| `phone` | string | No | Phone number (if required by the Chili Piper form) |
| `custom_params` | object | No | Additional custom fields required by your Chili Piper form |

#### Example Request

```bash
curl -X POST 'https://chilipiper.onrender.com/api/get-slots' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your_api_key_here' \
  -d '{
    "chili_piper_url": "https://company.chilipiper.com/me/user/meeting-type",
    "max_days": "7",
    "max_slots_per_day": "10",
    "timezone": "America/New_York"
  }'
```

#### Success Response (200)

```json
{
  "success": true,
  "status": 200,
  "code": "SCRAPING_SUCCESS",
  "data": {
    "total_slots": 12,
    "total_days": 3,
    "slots": [
      {
        "date": "2026-01-21",
        "time": "9:00 AM",
        "gmt": "America/New_York"
      },
      {
        "date": "2026-01-21",
        "time": "9:30 AM",
        "gmt": "America/New_York"
      },
      {
        "date": "2026-01-22",
        "time": "10:00 AM",
        "gmt": "America/New_York"
      }
    ],
    "timezone": "America/New_York"
  },
  "timestamp": "2026-01-21T12:00:00.000Z",
  "requestId": "req_1234567890_abc123",
  "responseTime": 15234
}
```

---

### 2. Book a Slot

Books a specific meeting slot on the Chili Piper calendar.

**Endpoint:** `POST /api/book-slot`

#### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `X-API-Key` | Yes | Your API key |

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chili_piper_url` | string | **Yes** | The Chili Piper booking URL |
| `dateTime` | string | **Yes** | The date and time to book (format: `January 22, 2026 at 9:30 AM`) |
| `timezone` | string | No | User's timezone in IANA format. Browser will emulate this timezone so times match what user expects. |
| `email` | string | No | Email address for the booking |
| `firstName` | string | No | First name for the booking |
| `lastName` | string | No | Last name for the booking |
| `phone` | string | No | Phone number for the booking |
| `custom_params` | object | No | Additional custom fields required by your Chili Piper form |

#### Date/Time Format

The `dateTime` field accepts these formats:
- `January 22, 2026 at 9:30 AM`
- `January 22, 2026 at 9:30 PM`
- `November 13, 2025 at 1:25 PM CST` (with timezone abbreviation)
- `November 13, 2025 at 1:25 PM America/Chicago` (with IANA timezone)

#### Example Request

```bash
curl -X POST 'https://chilipiper.onrender.com/api/book-slot' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your_api_key_here' \
  -d '{
    "chili_piper_url": "https://company.chilipiper.com/me/user/meeting-type",
    "dateTime": "January 22, 2026 at 9:30 AM",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "timezone": "America/New_York"
  }'
```

#### Success Response (200)

```json
{
  "success": true,
  "status": 200,
  "code": "OPERATION_SUCCESS",
  "data": {
    "message": "Slot booked successfully",
    "date": "2026-01-22",
    "time": "9:30 AM"
  },
  "timestamp": "2026-01-21T12:54:21.315Z",
  "requestId": "req_1234567890_abc123",
  "responseTime": 7649
}
```

---

### 3. Health Check

Simple endpoint to verify the API is running.

**Endpoint:** `GET /api/health`

#### Example Request

```bash
curl 'https://chilipiper.onrender.com/api/health'
```

#### Success Response (200)

```json
{
  "status": "ok",
  "timestamp": "2026-01-21T12:00:00.000Z"
}
```

---

## Error Responses

All error responses follow this structure:

```json
{
  "success": false,
  "status": 400,
  "code": "ERROR_CODE",
  "timestamp": "2026-01-21T12:00:00.000Z",
  "requestId": "req_1234567890_abc123",
  "responseTime": 100,
  "error": {
    "type": "CLIENT_ERROR",
    "message": "Human-readable error message",
    "details": "Additional details about the error",
    "metadata": {}
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `REQUEST_TIMEOUT` | 504 | Request timed out |
| `QUEUE_FULL` | 503 | Too many concurrent requests |
| `SCRAPING_FAILED` | 500 | Failed to scrape Chili Piper |
| `BOOKING_FAILED` | 500 | Failed to book the slot |

---

## Common Timezones

| Timezone | Description |
|----------|-------------|
| `America/New_York` | US Eastern Time |
| `America/Chicago` | US Central Time |
| `America/Denver` | US Mountain Time |
| `America/Los_Angeles` | US Pacific Time |
| `Europe/London` | UK Time |
| `Europe/Paris` | Central European Time |
| `Asia/Jerusalem` | Israel Time |
| `Asia/Tokyo` | Japan Time |
| `Australia/Sydney` | Australian Eastern Time |

---

## Workflow Example

### Step 1: Get Available Slots

```bash
curl -X POST 'https://chilipiper.onrender.com/api/get-slots' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your_api_key_here' \
  -d '{
    "chili_piper_url": "https://altahq.chilipiper.com/me/adiel-halevi/meeting-with-adiel",
    "max_days": "7",
    "max_slots_per_day": "5",
    "timezone": "Asia/Jerusalem"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "total_slots": 12,
    "total_days": 3,
    "slots": [
      { "date": "2026-01-21", "time": "4:00 PM", "gmt": "Asia/Jerusalem" },
      { "date": "2026-01-21", "time": "4:30 PM", "gmt": "Asia/Jerusalem" },
      { "date": "2026-01-22", "time": "9:30 AM", "gmt": "Asia/Jerusalem" }
    ],
    "timezone": "Asia/Jerusalem"
  }
}
```

### Step 2: Book a Slot

Using a slot from the response above:

```bash
curl -X POST 'https://chilipiper.onrender.com/api/book-slot' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: your_api_key_here' \
  -d '{
    "chili_piper_url": "https://altahq.chilipiper.com/me/adiel-halevi/meeting-with-adiel",
    "dateTime": "January 22, 2026 at 9:30 AM",
    "email": "user@company.com",
    "firstName": "John",
    "lastName": "Doe",
    "timezone": "Asia/Jerusalem"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "Slot booked successfully",
    "date": "2026-01-22",
    "time": "9:30 AM"
  }
}
```

---

## Rate Limits

- **get-slots:** 50 requests per 15 minutes
- **book-slot:** 30 requests per 15 minutes

---

## Custom Form Parameters

If your Chili Piper form requires additional fields, use the `custom_params` object:

```json
{
  "chili_piper_url": "https://company.chilipiper.com/me/user/meeting",
  "max_days": "7",
  "max_slots_per_day": "10",
  "custom_params": {
    "company": "Acme Inc",
    "job_title": "CEO",
    "employees": "50-100"
  }
}
```

---

## Notes

1. **Timezone Handling:** When you specify a `timezone`, the browser emulates that timezone so Chili Piper displays times directly in your local time. Always use the same timezone for both `get-slots` and `book-slot`.

2. **Response Time:** Scraping operations typically take 10-30 seconds depending on calendar availability.

3. **Cold Starts:** The first request after the server has been idle may take longer due to browser initialization.

4. **Test Mode:** Emails containing "test" (e.g., `test@example.com`) trigger test mode and won't create real bookings.
