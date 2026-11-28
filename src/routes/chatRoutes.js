/** TUTU AI - chat routes. */
const express = require('express');
const router = express.Router();
const controller = require('../controllers/chatController');
const { chatUpload } = require('../middleware/uploadValidation');
const { chatLimiter } = require('../middleware/rateLimiter');

// Text and/or image (multipart/form-data). Image is kept in memory only.
router.post('/chat', chatLimiter, chatUpload.single('image'), controller.chat);

// Text-only streaming (JSON body) via Server-Sent Events.
router.post('/chat/stream', chatLimiter, express.json({ limit: '256kb' }), controller.chatStream);

module.exports = router;
