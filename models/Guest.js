import mongoose from 'mongoose';

const guestSchema = new mongoose.Schema({
    guestId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    fingerprint: {
        type: String,
        index: true
    },
    ip: {
        type: String,
        index: true
    },
    sessionIds: [{
        type: String
    }]
}, { timestamps: true });

const Guest = mongoose.model('Guest', guestSchema);
export default Guest;
