import express from 'express';
import Feedback from '../models/Feedback.js';
import { sendFeedbackEmail } from '../utils/Email.js';

const router = express.Router();

// POST /api/feedback
router.post('/', async (req, res) => {
    try {
        const { sessionId, messageId, type, categories, details } = req.body;

        // Simple validation
        if (!sessionId || !messageId || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const newFeedback = new Feedback({
            // userId: req.user ? req.user._id : null, 
            sessionId,
            messageId,
            type,
            categories,
            details
        });

        await newFeedback.save();

        // Send email notification to admin asynchronously
        sendFeedbackEmail(newFeedback).catch(err =>
            console.error('Error sending feedback email:', err)
        );

        res.status(201).json({ message: 'Feedback submitted successfully', feedback: newFeedback });
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/feedback (Admin only)
router.get('/', async (req, res) => {
    try {
        const feedbacks = await Feedback.find().sort({ timestamp: -1 }).limit(50);
        res.json(feedbacks);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching feedback' });
    }
});

export default router;
