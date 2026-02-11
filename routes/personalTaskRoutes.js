import express from 'express';
import { verifyToken } from '../middleware/authorization.js';
import { getTasks, createTask, updateTask, deleteTask } from '../controllers/personalTaskController.js';

const router = express.Router();

router.use(verifyToken);

router.get('/', getTasks);
router.post('/', createTask);
router.put('/:id', updateTask);
router.delete('/:id', deleteTask);

export default router;
