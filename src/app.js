/** TUTU AI - Express app setup. */
const express = require('express');
const cors = require('cors');
const path = require('path');

const chatRoutes = require('./routes/chatRoutes');
const { chatLimiter, generalLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Trust the proxy only in production deployments behind HTTPS reverse proxies.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// CORS: allow the app's own requests. For production, set ALLOWED_ORIGIN
// (e.g. your deployed domain) in .env to restrict access.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin ? [allowedOrigin] : true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400
  })
);

// Request timeouts and body limits.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use((req, res, next) => {
  req.setTimeout(120000); // 120s hard cap per request
  res.setTimeout(120000);
  next();
});

// Health endpoint.
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'TUTU AI Backend',
    version: '1.0.0',
    model: require('./config/gemini').MODEL,
    apiKeyConfigured: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY'),
    time: new Date().toISOString()
  });
});

// API routes (rate limited).
app.use('/api', generalLimiter, chatRoutes);
app.post('/api/chat', chatLimiter, (req, res, next) => next());

// 404 handler.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found.' }
  });
});

app.use(errorHandler);

module.exports = app;
