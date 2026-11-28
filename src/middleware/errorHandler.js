/**
 * TUTU AI - centralized error handler.
 * Returns structured JSON errors, never leaking internal details.
 */
function errorHandler(err, req, res, next) {
  let code = err.code || 'API_ERROR';
  let message = err.message || 'Unable to process your request.';
  let status = err.status || 500;

  if (code === 'LIMIT_FILE_SIZE') {
    code = 'FILE_TOO_LARGE';
    message = 'Image is too large. Maximum size is 10 MB.';
    status = 413;
  } else if (code === 'UNSUPPORTED_FORMAT') {
    status = 415;
  } else if (code === 'LIMIT_UNEXPECTED_FILE') {
    code = 'VALIDATION_ERROR';
    message = 'Unexpected file field. Attach the image in the "image" field.';
    status = 400;
  } else if (code === 'CONFIG_ERROR') {
    status = 503; // server not configured yet
  } else if (err.type === 'entity.too.large') {
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload is too large.';
    status = 413;
  } else if (err.type === 'entity.parse.failed') {
    code = 'VALIDATION_ERROR';
    message = 'Invalid JSON body.';
    status = 400;
  }

  // Log unexpected errors only (no user content, no secrets).
  if (status >= 500 && code !== 'CONFIG_ERROR') {
    console.error('[tutu-ai] error:', code, message.slice(0, 200));
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message: status >= 500 && code === 'API_ERROR'
        ? 'Unable to process your request. Please try again.'
        : message
    }
  });
}

module.exports = { errorHandler };
