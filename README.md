# TUTU AI — Node.js Backend

Secure Gemini-primary, Groq-fallback backend for the TUTU AI Android app.
The Gemini API key lives ONLY on this server — it is never shipped inside the Android app.

## 1. Setup

```bash
cd server
npm install
cp .env.example .env
```

Then edit `.env`:

```
GEMINI_API_KEY=your_key_from_aistudio_google_com_apikey
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=your_groq_key_from_console_groq_com_keys
GROQ_MODEL=llama-4-scout-17b-16e-instruct
PORT=5000
```

## 2. Run

```bash
npm start
# -> [tutu-ai] Backend running on port 5000
```

## 3. Endpoints

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/api/health` | GET | — | Server status + whether the API key is configured |
| `/api/chat` | POST | multipart/form-data: `message` (text), `history` (JSON array, optional), `image` (file, optional) | Full AI reply as JSON `{success, reply}`. Supports text-only, image-only, or text+image. |
| `/api/chat/stream` | POST | JSON: `{message, history}` | Server-Sent Events stream of text chunks (`{chunk}` … `{done}`), text-only |

Error responses always follow this shape:

```json
{ "success": false, "error": { "code": "API_ERROR", "message": "..." } }
```

Error codes: `VALIDATION_ERROR`, `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`, `RATE_LIMITED`,
`INVALID_API_KEY`, `QUOTA_EXCEEDED`, `MODEL_NOT_FOUND`, `NETWORK_ERROR`, `API_ERROR`, `CONFIG_ERROR`.

## 4. AI provider fallback

Gemini is attempted first. If Gemini is rate-limited, unavailable, or returns a temporary service error, the backend automatically switches to Groq. Groq is retried up to three times with short delays. Keep both keys in this server `.env` file only; never put provider keys in the Android app. The default Groq model is a vision-capable model for text and image requests; check current model availability in your Groq console.

## 5. Security

- API key only in `.env` (never committed — `.gitignore` excludes it).
- Memory-based image handling: uploaded images are processed in RAM and never written to disk.
- Image MIME allow-list: JPEG/JPG/PNG/WEBP, max 10 MB.
- Rate limiting: 20 chat requests/minute/IP (configurable in `src/middleware/rateLimiter.js`).
- Request timeouts, payload limits, safe error messages, CORS control via `ALLOWED_ORIGIN`.
- For production, deploy behind HTTPS (e.g. a free Render/Railway/Fly.io service) and set `ALLOWED_ORIGIN`.

## 6. Models

`GEMINI_MODEL` must be a multimodal model. Supported choices include:
`gemini-2.5-flash` (default, fast + free-tier friendly), `gemini-2.5-pro`, `gemini-2.0-flash`.

## 7. Connecting the Android app

- Android Emulator → app setting "Backend URL" = `http://10.0.2.2:5000`
- Physical phone on the same Wi-Fi → `http://<your-computer-LAN-IP>:5000`
  (find it with `ipconfig` on Windows / `ifconfig` on macOS-Linux)
- Production → your deployed HTTPS URL.
