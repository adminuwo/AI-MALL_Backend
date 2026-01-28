import mongoose from 'mongoose';
import dns from 'dns';
import { MONGO_URI } from './env.js';
import logger from '../utils/logger.js';

// Force IPv4 first to avoid DNS resolution issues
dns.setDefaultResultOrder('ipv4first');

const connectDB = async () => {
  try {
    logger.info('Attempting to connect to MongoDB...');
    const uri = MONGO_URI || process.env.MONGODB_ATLAS_URI;
    const sanitizedUri = uri ? uri.replace(/:([^@]+)@/, ':****@') : 'UNDEFINED';
    logger.info(`Using URI: ${sanitizedUri}`);

    if (!uri) {
      throw new Error("MONGODB_ATLAS_URI is not defined in environment variables");
    }

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4
      retryWrites: true,
      w: 'majority',
    });

    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error(`MongoDB connection error: ${err}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected successfully');
    });

  } catch (error) {
    logger.error(`❌ MongoDB Connection Failed: ${error.message}`);
    logger.error('Please check:');
    logger.error('1. Internet connectivity');
    logger.error('2. MongoDB Atlas cluster status');
    logger.error('3. DNS resolution (try using Google DNS: 8.8.8.8)');

    throw error; // Re-throw so startServer knows it failed
  }
};

export default connectDB;
