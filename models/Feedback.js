import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    sessionId: {
        type: String,
        required: true
    },
    messageId: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['thumbs_up', 'thumbs_down'],
        required: true
    },
    categories: [{
        type: String
    }],
    details: {
        type: String
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const Feedback = mongoose.model('Feedback', feedbackSchema);

export default Feedback;
