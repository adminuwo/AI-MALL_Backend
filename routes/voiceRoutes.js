import express from 'express';
import { synthesizeSpeech, synthesizeFile } from '../controllers/voiceController.js';

const router = express.Router();

router.post('/synthesize', synthesizeSpeech);
router.post('/synthesize-file', synthesizeFile);

export default router;
