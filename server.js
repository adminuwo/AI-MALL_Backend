import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import connectDB from "./config/db.js";
import { PORT } from "./config/env.js";

// Route imports
import chatRoutes from "./routes/chatRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import agentRoutes from "./routes/agentRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import emailVatifiation from "./routes/emailVerification.js"
import vendorOnboardingRoutes from "./routes/vendorOnboardingRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import dashboardMessageRoutes from "./routes/dashboardMessageRoutes.js";
import userRoute from './routes/user.js'
import reportRoutes from './routes/reportRoutes.js';
import pdfRoutes from './routes/pdfRoutes.js';
import aibizRoutes from './routes/aibizRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import revenueRoutes from './routes/revenueRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import supportChatRoutes from './routes/supportChatRoutes.js';
import vendorChatRoutes from './routes/vendorChatRoutes.js';
import aibaseApp from './aibase_module/app.js';
import { dynamicRateLimiter } from "./middleware/dynamicRateLimiter.js";
import imageRoutes from "./routes/imageRoutes.js";
import videoRoutes from "./routes/videoRoutes.js";
import voiceRoutes from "./routes/voiceRoutes.js";
import feedbackRoutes from "./routes/feedbackRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import reminderRoutes from "./routes/reminderRoutes.js";
import personalTaskRoutes from "./routes/personalTaskRoutes.js";

const app = express();

// ULTRA-DEBUG: Log every single request to the server
app.use((req, res, next) => {
  console.log(`[GLOBAL DEBUG] ${req.method} ${req.originalUrl}`);
  next();
});

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
      'http://localhost:3000',
      'http://localhost:3001',
      'https://ai-mall-de2a.onrender.com'
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost')) {
      return callback(null, true);
    }
    const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'x-device-fingerprint',
    'X-Device-Fingerprint',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['Content-Length', 'X-Request-Id']
}));
app.use(cookieParser())
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Basic Routes
app.get("/ping-top", (req, res) => {
  res.send("Top ping works");
})

app.get("/", (req, res) => {
  res.send("All working")
})

// Log all /api requests
app.use('/api', (req, res, next) => {
  console.log(`[API DEBUG] ${req.method} ${req.url}`);
  next();
});

// Rate Limiter
app.use('/api', dynamicRateLimiter);

// Mount Routes
app.use('/api/aibase', aibaseApp);
app.use('/api/user', userRoute);
app.use('/api/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/agents', agentRoutes);
app.use("/api/email_varification", emailVatifiation);
app.use('/api/vendor', vendorOnboardingRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/pdf', pdfRoutes);
app.use('/api/aibiz', aibizRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/support-chat', supportChatRoutes);
app.use('/api/vendor-chat', vendorChatRoutes);
app.use('/api/image', imageRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/personal-assistant', personalTaskRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!', details: err.message });
});

// Start Server Function
const startServer = async () => {
  try {
    console.log("Starting server initialization...");
    try {
      await connectDB();
      console.log("Database connection successful.");
    } catch (dbErr) {
      console.warn("⚠️  MongoDB connection failed. Server will start without database:");
      console.warn(dbErr.message);
      console.warn("Some features requiring database may not work properly.");
    }

    console.log("Starting Express server...");
    app.listen(PORT, () => {
      console.log(`✅ A-Series Backend running on port ${PORT}`);
      console.log(`📡 CORS enabled for localhost ports`);
    });
  } catch (err) {
    console.error("CRITICAL: Failed to start Express server:");
    console.error(err);
    process.exit(1);
  }
};

startServer();
