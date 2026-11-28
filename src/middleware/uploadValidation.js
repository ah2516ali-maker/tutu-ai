/**
 * TUTU AI - upload validation.
 * Memory-based storage (no temp files, nothing saved on the server),
 * strict MIME type allow-list and size limit for image uploads.
 */
const multer = require('multer');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB hard limit before app-side compression

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      const err = new Error('Unsupported image format. Use JPEG, JPG, PNG or WEBP.');
      err.code = 'UNSUPPORTED_FORMAT';
      return cb(err);
    }
    cb(null, true);
  }
});

const chatUpload = upload;

module.exports = { chatUpload, ALLOWED_MIME, MAX_IMAGE_BYTES };
