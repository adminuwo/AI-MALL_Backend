import express from 'express';
import * as knowledgeController from '../controllers/knowledge.controller.js';
import uploadMiddleware from '../middlewares/upload.middleware.js';

const router = express.Router();

router.post('/upload', uploadMiddleware, knowledgeController.uploadDocument);
router.get('/documents', knowledgeController.getDocuments);
router.delete('/:id', knowledgeController.deleteDocument);

export default router;
