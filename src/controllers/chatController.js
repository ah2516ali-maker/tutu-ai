/**
 * TUTU AI - chat controller.
 * POST /api/chat        multipart/form-data (text and/or image) -> full JSON reply
 * POST /api/chat/stream JSON body (text only) -> Server-Sent Events stream
 * GET  /api/health      (defined in app.js)
 *
 * Uploaded images are kept in memory only and never written to disk.
 */
const geminiService = require('../services/geminiService');

const MAX_MESSAGE_LENGTH = 8000;

/** Parse and sanitize the conversation history sent by the app. */
function parseHistory(raw) {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.slice(-20).map((h) => ({
    role: h && h.role === 'model' ? 'model' : 'user',
    text: String((h && h.text) || '').slice(0, 6000)
  }));
}

function errorPayload(code, message) {
  return { success: false, error: { code, message } };
}

// GET /api/health is registered in app.js

/** POST /api/chat - text and/or image (multipart/form-data). */
async function chat(req, res, next) {
  try {
    const message = String((req.body && req.body.message) || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    const imageFile = req.file || null;

    if (!message && !imageFile) {
      return res.status(400).json(errorPayload('VALIDATION_ERROR', 'Message text or an image is required.'));
    }

    const history = parseHistory(req.body && req.body.history);
    const image = imageFile
      ? { mimeType: imageFile.mimetype, data: imageFile.buffer.toString('base64') }
      : null;

    // Release the buffer reference as soon as it is encoded; nothing is stored.
    const reply = await geminiService.generateReply({ history, message, image });

    res.json({ success: true, reply });
  } catch (err) {
    next(err);
  }
}

/** POST /api/chat/stream - text-only streaming over Server-Sent Events. */
async function chatStream(req, res, next) {
  let closed = false;
  // Listen on the response: IncomingMessage 'close' can fire after a normal body read.
  res.on('close', () => { if (!res.writableEnded) closed = true; });

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();

  const send = (obj) => {
    if (!closed) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  try {
    const message = String((req.body && req.body.message) || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!message) {
      send({ error: { code: 'VALIDATION_ERROR', message: 'Message text is required.' } });
      return res.end();
    }
    const history = parseHistory(req.body && req.body.history);

    let gotAny = false;
    for await (const chunk of geminiService.streamReply({ history, message })) {
      if (closed) break; // client pressed Stop
      gotAny = true;
      send({ chunk });
    }
    if (!gotAny && !closed) {
      send({ error: { code: 'API_ERROR', message: 'The AI returned an empty response. Please try again.' } });
    }
    send({ done: true });
    res.end();
  } catch (err) {
    if (!closed) {
      const code = err.code || 'API_ERROR';
      const safe = code === 'API_ERROR' || code === 'QUOTA_EXCEEDED' ||
        code === 'INVALID_API_KEY' || code === 'NETWORK_ERROR' || code === 'MODEL_NOT_FOUND' ||
        code === 'CONFIG_ERROR';
      send({
        error: {
          code,
          message: safe ? err.message : 'Unable to process your request. Please try again.'
        }
      });
      try { res.end(); } catch (e) { /* already closed */ }
    }
  }
}

module.exports = { chat, chatStream, parseHistory };
