import mongoose from 'mongoose';

const personalTaskSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String
    },
    category: {
        type: String,
        default: 'Personal'
    },
    datetime: {
        type: Date,
        required: true
    },
    recurring: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly'],
        default: 'none'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'missed'],
        default: 'pending'
    },
    isUrgent: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

const PersonalTask = mongoose.model('PersonalTask', personalTaskSchema);
export default PersonalTask;
