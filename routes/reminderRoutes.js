import express from 'express';
import Reminder from '../models/Reminder.js';
import { verifyToken } from '../middleware/authorization.js';

const router = express.Router();

// Create a new reminder
router.post('/', verifyToken, async (req, res) => {
    try {
        const { title, datetime, notification, alarm, voice, voiceMessage, intent } = req.body;

        const reminder = new Reminder({
            userId: req.user.id,
            title,
            datetime,
            notification: notification !== undefined ? notification : true,
            alarm: alarm !== undefined ? alarm : false,
            voice: voice !== undefined ? voice : false,
            voiceMessage: voiceMessage || '',
            intent: intent || 'reminder_notification_only'
        });

        await reminder.save();

        res.status(201).json({
            success: true,
            reminder,
            message: 'Reminder created successfully'
        });
    } catch (error) {
        console.error('Create reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create reminder'
        });
    }
});

// Get all reminders for user
router.get('/', verifyToken, async (req, res) => {
    try {
        const { status } = req.query;

        const query = { userId: req.user.id };
        if (status) {
            query.status = status;
        }

        const reminders = await Reminder.find(query)
            .sort({ datetime: 1 })
            .limit(100);

        res.json({
            success: true,
            reminders
        });
    } catch (error) {
        console.error('Get reminders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch reminders'
        });
    }
});

// Get upcoming reminders (next 24 hours)
router.get('/upcoming', verifyToken, async (req, res) => {
    try {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const reminders = await Reminder.find({
            userId: req.user.id,
            status: 'pending',
            datetime: { $gte: now, $lte: tomorrow }
        }).sort({ datetime: 1 });

        res.json({
            success: true,
            reminders
        });
    } catch (error) {
        console.error('Get upcoming reminders error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch upcoming reminders'
        });
    }
});

// Update reminder
router.put('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const reminder = await Reminder.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            updates,
            { new: true }
        );

        if (!reminder) {
            return res.status(404).json({
                success: false,
                error: 'Reminder not found'
            });
        }

        res.json({
            success: true,
            reminder,
            message: 'Reminder updated successfully'
        });
    } catch (error) {
        console.error('Update reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update reminder'
        });
    }
});

// Delete reminder
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const reminder = await Reminder.findOneAndDelete({
            _id: id,
            userId: req.user.id
        });

        if (!reminder) {
            return res.status(404).json({
                success: false,
                error: 'Reminder not found'
            });
        }

        res.json({
            success: true,
            message: 'Reminder deleted successfully'
        });
    } catch (error) {
        console.error('Delete reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete reminder'
        });
    }
});

// Mark reminder as completed
router.patch('/:id/complete', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const reminder = await Reminder.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            { status: 'completed' },
            { new: true }
        );

        if (!reminder) {
            return res.status(404).json({
                success: false,
                error: 'Reminder not found'
            });
        }

        res.json({
            success: true,
            reminder,
            message: 'Reminder marked as completed'
        });
    } catch (error) {
        console.error('Complete reminder error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to complete reminder'
        });
    }
});

export default router;
