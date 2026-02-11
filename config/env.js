import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from AIMALL-BACKEND root
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log("DEBUG ENV: MONGODB_ATLAS_URI from process.env:", process.env.MONGODB_ATLAS_URI);

export const PORT = process.env.PORT || 8080;
export const MONGO_URI = process.env.MONGODB_ATLAS_URI;
export const JWT_SECRET = process.env.JWT_SECRET;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const APP_NAME = process.env.APP_NAME || 'AI-MALL';
export const TOKEN_EX = process.env.TOKEN_EX ? process.env.TOKEN_EX.trim() : '7d';
