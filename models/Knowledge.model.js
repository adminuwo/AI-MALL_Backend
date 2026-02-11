import mongoose from 'mongoose';

const KnowledgeSchema = new mongoose.Schema({
    filename: {
        type: String,
        required: true
    },
    cloudinaryUrl: {
        type: String,
        required: true
    },
    cloudinaryId: {
        type: String, // Public ID
        required: true
    },
    mimetype: {
        type: String
    },
    size: {
        type: Number // In bytes
    },
    // content: { type: String } // Removed to save metadata only
    uploadDate: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('AIBaseKnowledge', KnowledgeSchema);
