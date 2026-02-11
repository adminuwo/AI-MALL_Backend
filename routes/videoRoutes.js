import express from 'express';
import { generateVideo, getVideoStatus } from '../controllers/videoController.js';
import { verifyToken } from '../middleware/authorization.js';

const router = express.Router();

// Generate video from text prompt
router.post('/generate', verifyToken, generateVideo);

// Get video generation status
router.get('/status/:videoId', verifyToken, getVideoStatus);

export default router;
