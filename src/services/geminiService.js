/**
 * TUTU AI - Gemini service.
 * Converts app requests into Gemini `contents` payloads (text-only and image+text)
 * using the official @google/genai SDK, with streaming support.
 */
const { getClient, MODEL, SYSTEM_INSTRUCTION, isKnownMultimodal } = require('../config/gemini');

const MAX_HISTORY_TURNS = 20;
const MAX_HISTORY_TEXT = 6000;

function ApiError(code, message, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

/** Build Gemini `contents` from sanitized app history + the current user parts. */
function buildContents(history, userParts) {
  const contents = [];
  const turns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
  for (const h of turns) {
    const role = h && h.role === 'model' ? 'model' : 'user';
    const text = String((h && h.text) || '').slice(0, MAX_HISTORY_TEXT).trim();
    if (!text) continue;
    contents.push({ role, parts: [{ text }] });
  }
  contents.push({ role: 'user', parts: userParts });
  return contents;
}

function buildUserParts(message, image) {
  const parts = [];
  if (image) {
    // Multimodal input format: inline base64 image + prompt text.
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }
  const text = String(message || '').trim();
  if (text) parts.push({ text });
  if (parts.length === 0) {
    throw ApiError('VALIDATION_ERROR', 'Message text or an image is required.', 400);
  }
  return parts;
}

function assertModelConfigured() {
  if (!process.env.GEMINI_MODEL) return; // default applies
  if (!isKnownMultimodal(MODEL)) {
    // Do not hard-fail (Google adds models over time) but warn in logs.
    console.warn(
      `[tutu-ai] GEMINI_MODEL "${MODEL}" is not in the known multimodal list. ` +
      'Make sure it supports image input, otherwise image analysis will fail.'
    );
  }
}

/** Groq fallback. Keys stay on the backend and are never shipped to Android. */
async function generateWithGroq({ history = [], message = '', image = null }) {
  const key = process.env.GROQ_API_KEY || '';
  if (!key) throw ApiError('CONFIG_ERROR', 'Both AI providers are unavailable: configure GROQ_API_KEY in server .env.', 503);
  const messages = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
  for (const h of (Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [])) {
    const text = String((h && h.text) || '').slice(0, MAX_HISTORY_TEXT).trim();
    if (text) messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: text });
  }
  let content = String(message || '').trim();
  if (image) {
    content = [
      { type: 'text', text: content || 'Please analyze this image carefully.' },
      { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
    ];
  }
  messages.push({ role: 'user', content });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-4-scout-17b-16e-instruct',
        messages, temperature: 0.7, max_tokens: 4096
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const e = new Error((data.error && data.error.message) || `Groq HTTP ${response.status}`);
      e.status = response.status; throw e;
    }
    const answer = data.choices?.[0]?.message?.content;
    if (!answer || !String(answer).trim()) throw new Error('Groq returned an empty response');
    return String(answer);
  } catch (e) {
    if (e.name === 'AbortError') throw ApiError('NETWORK_ERROR', 'The AI services could not be reached. Check your internet connection and try again.', 504);
    throw e;
  } finally { clearTimeout(timer); }
}

function shouldFallback(err) {
  return ['QUOTA_EXCEEDED','NETWORK_ERROR','API_ERROR','MODEL_NOT_FOUND'].includes(err?.code) ||
    (err?.code === 'CONFIG_ERROR' && Boolean(process.env.GROQ_API_KEY)) ||
    [429,500,502,503,504].includes(Number(err?.status));
}

/** Non-streaming generation. Returns the full reply text. */
async function generateReply({ history = [], message = '', image = null }) {
  try {
    assertModelConfigured();
    const ai = getClient();
    const userParts = buildUserParts(message, image);
    const contents = buildContents(history, userParts);
    const response = await ai.models.generateContent({
      model: MODEL, contents,
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7, maxOutputTokens: 8192 }
    });
    const text = (response && response.text) || '';
    if (!String(text).trim()) throw ApiError('API_ERROR', 'The AI returned an empty response.', 502);
    return String(text);
  } catch (raw) {
    const err = mapGeminiError(raw);
    if (!shouldFallback(err)) throw err;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await generateWithGroq({ history, message, image }); }
      catch (groqErr) {
        lastError = groqErr;
        if (groqErr.code === 'CONFIG_ERROR') break;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 900 * (attempt + 1)));
      }
    }
    if (lastError?.code === 'CONFIG_ERROR') throw ApiError('PROVIDERS_BUSY', 'Both AI providers are unavailable right now. Please try again shortly.', 503);
    if (lastError?.status === 429 || [500,502,503,504].includes(Number(lastError?.status)))
      throw ApiError('PROVIDERS_BUSY', 'Both AI providers are busy right now. TUTU tried again automatically. Please try again shortly.', 503);
    throw lastError;
  }
}

/** Streaming generation. Yields text chunks as they arrive. */
async function* streamReply({ history = [], message = '' }) {
  try {
    assertModelConfigured();
    const ai = getClient();
    const contents = buildContents(history, buildUserParts(message, null));
    const stream = await ai.models.generateContentStream({
      model: MODEL, contents,
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.7, maxOutputTokens: 8192 }
    });
    for await (const chunk of stream) { const t = chunk && chunk.text; if (t) yield t; }
  } catch (raw) {
    const err = mapGeminiError(raw);
    if (!shouldFallback(err)) throw err;
    let fallback = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { fallback = await generateWithGroq({ history, message, image: null }); break; }
      catch (e) { lastError = e; if (e.code === 'CONFIG_ERROR') break; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 900 * (attempt + 1))); }
    }
    if (!fallback) {
      if (lastError?.code === 'CONFIG_ERROR') throw ApiError('PROVIDERS_BUSY', 'Both AI providers are unavailable right now. Please try again shortly.', 503);
      throw ApiError('PROVIDERS_BUSY', 'Both AI providers are busy right now. TUTU tried again automatically. Please try again shortly.', 503);
    }
    for (let i = 0; i < fallback.length; i += 48) yield fallback.slice(i, i + 48);
  }
}

/** Translate SDK/network errors into safe, structured API errors. */
function mapGeminiError(err) {
  if (err && err.code === 'VALIDATION_ERROR') return err;
  const msg = String((err && err.message) || '');
  const status = (err && (err.status || err.code)) || '';
  const s = String(status);

  if (s === '401' || s === '403' || /api key|API_KEY|permission/i.test(msg)) {
    return ApiError('INVALID_API_KEY', 'The Gemini API key is invalid or missing permissions.', 502);
  }
  if (s === '429' || /quota|rate limit|resource.?exhausted/i.test(msg)) {
    return ApiError('QUOTA_EXCEEDED', 'The Gemini API quota is exhausted. Please try again later.', 502);
  }
  if (s === '404' || /not found|is not supported/i.test(msg)) {
    return ApiError('MODEL_NOT_FOUND', 'The configured Gemini model is not available. Check GEMINI_MODEL in .env.', 502);
  }
  if (s === '400' || /invalid/i.test(msg)) {
    return ApiError('API_ERROR', 'Gemini rejected the request. ' + msg.slice(0, 200), 502);
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed|network/i.test(msg)) {
    return ApiError('NETWORK_ERROR', 'Could not reach the Gemini service. Check your internet connection.', 504);
  }
  console.error('[tutu-ai] Gemini error:', msg.slice(0, 300));
  return ApiError('API_ERROR', 'Unable to process your request. Please try again.', 502);
}

module.exports = { generateReply, streamReply, buildContents, buildUserParts, MODEL, generateWithGroq };
