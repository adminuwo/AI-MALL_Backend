import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    datetime: {
        type: Date,
        required: true,
        index: true
    },
    notification: {
        type: Boolean,
        default: true
    },
    alarm: {
        type: Boolean,
        default: false
    },
    voice: {
        type: Boolean,
        default: false
    },
    voiceMessage: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'cancelled'],
        default: 'pending',
        index: true
    },
    intent: {
        type: String,
        enum: ['reminder_with_alarm', 'reminder_notification_only', 'alarm_only', 'task_only'],
        default: 'reminder_notification_only'
    }
}, { timestamps: true });

// Index for querying pending reminders
reminderSchema.index({ userId: 1, status: 1, datetime: 1 });

const Reminder = mongoose.model('Reminder', reminderSchema);

export default Reminder;
