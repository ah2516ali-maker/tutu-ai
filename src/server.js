/** TUTU AI - server entry point. */
const app = require('./app');

const PORT = parseInt(process.env.PORT || '5000', 10);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[tutu-ai] Backend running on port ${PORT}`);
  console.log(`[tutu-ai] Health check: http://localhost:${PORT}/api/health`);
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
    console.warn('[tutu-ai] WARNING: GEMINI_API_KEY is not set. Add it to the .env file.');
  }
});

// Graceful shutdown.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
