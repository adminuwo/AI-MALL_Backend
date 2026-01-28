import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', userSchema, 'users');

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_ATLAS_URI);
        const user = await User.findOne({ email: 'admin@uwo24.com' });
        if (user) {
            console.log('USER FOUND:', JSON.stringify(user, null, 2));
        } else {
            console.log('USER NOT FOUND: admin@uwo24.com');
        }
    } catch (err) {
        console.error('ERROR:', err);
    }
    process.exit(0);
}

check();
