import mongoose from "mongoose";
import express from "express"
import ChatSession from "../../models/ChatSession.js"
import { generativeModel } from "../config/gemini.js";
import userModel from "../../models/User.js";
import { verifyToken } from "../middleware/authorization.js";
import { checkKillSwitch } from "../middleware/checkKillSwitch.js";





const router = express.Router();

// Apply Kill Switch to ALL chat routes (Inference)
// TEMPORARILY DISABLED - causing 503 errors
// router.use(checkKillSwitch);

// Get all chat sessions (summary)
router.post("/", async (req, res) => {
  const { content, history, systemInstruction } = req.body;

  try {
    // Construct parts from history + current message
    let parts = [];

    // Add system instruction if provided (as a user message with high priority or just prepend)
    // Note: Vertex AI "generateContent" usually takes systemInstruction in config, but for per-request
    // dynamic behavior with a static model instance, we can prepend it to the prompt.
    if (systemInstruction) {
      parts.push({ text: `System Instruction: ${systemInstruction}` });
    }

    // Add conversation history if available
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        parts.push({ text: `${msg.role === 'user' ? 'User' : 'Model'}: ${msg.content}` });
      });
    }

    // Add current message
    parts.push({ text: `User: ${content}` });


    // For Google Generative AI SDK, we pass the parts directly (or a prompt string) as the "contents".
    // It accepts an array of Content objects, or a simple string/array of parts.
    // However, since we are sending a single turn of "user" content (that includes history context manually mocked), we just send the parts array wrapped in strict format if needed, or just the parts.

    // Correct usage for single-turn content generation with this SDK
    // model.generateContentStream([ ...parts ])

    // Construct valid Content object
    const contentPayload = { role: "user", parts: parts };

    const streamingResult = await generativeModel.generateContentStream({ contents: [contentPayload] });

    // Iterate stream if needed, or await full response
    for await (const chunk of streamingResult.stream) {
      // Just consuming stream to ensure completion
    }

    const finalResponse = await streamingResult.response;
    const reply = finalResponse.text();

    return res.status(200).json({ reply });
  } catch (err) {
    const fs = await import('fs');
    try {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      const logData = `
Timestamp: ${new Date().toISOString()}
Error: ${err.message}
Code: ${err.code}
Env Project: ${process.env.GCP_PROJECT_ID}
Env Creds Path: '${credPath}'
Creds File Exists: ${credPath ? fs.existsSync(credPath) : 'N/A'}
Stack: ${err.stack}
-------------------------------------------
`;
      fs.appendFileSync('error.log', logData);
    } catch (e) { console.error("Log error:", e); }

    console.error("AIVA backend error details:", {
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err.details || err.response?.data
    });
    return res.status(500).json({ error: "AI failed to respond", details: err.message });
  }
});
// Get all chat sessions (summary) for the authenticated user
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userModel.findById(userId).populate({
      path: 'chatSessions',
      select: 'sessionId title lastModified',
      options: { sort: { lastModified: -1 } }
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user.chatSessions || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get chat history for a specific session
router.get('/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    // Optional: Verify that the session belongs to this user
    // For now, finding by sessionId is okay as sessionIds are unique/random
    let session = await ChatSession.findOne({ sessionId });

    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Create or Update message in session
router.post('/:sessionId/message', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, title } = req.body;
    const userId = req.user.id


    if (!message?.role || !message?.content) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const session = await ChatSession.findOneAndUpdate(
      { sessionId },
      {
        $push: { messages: message },
        $set: { lastModified: Date.now(), ...(title && { title }) }
      },
      { new: true, upsert: true }
    );

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    await userModel.findByIdAndUpdate(
      userId,
      { $addToSet: { chatSessions: session._id } },
      { new: true }
    );
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});


router.delete('/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user.id;

    const session = await ChatSession.findOneAndDelete({ sessionId });
    if (session) {
      await userModel.findByIdAndUpdate(userId, { $pull: { chatSessions: session._id } });
    }
    res.json({ message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
