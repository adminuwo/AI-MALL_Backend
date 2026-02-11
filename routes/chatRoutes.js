import mongoose from "mongoose";
import express from "express"
import ChatSession from "../models/ChatSession.js"
import { generativeModel, genAIInstance, modelName as primaryModelName } from "../config/vertex.js";
import userModel from "../models/User.js";
import Guest from "../models/Guest.js";
import { verifyToken, optionalVerifyToken } from "../middleware/authorization.js";
import { identifyGuest } from "../middleware/guestMiddleware.js";
import { uploadToCloudinary } from "../services/cloudinary.service.js";
import mammoth from "mammoth";
import { detectMode, getModeSystemInstruction } from "../utils/modeDetection.js";
import { detectIntent, extractReminderDetails, detectLanguage, getVoiceSystemInstruction } from "../utils/voiceAssistant.js";
import Reminder from "../models/Reminder.js";
import { requiresWebSearch, extractSearchQuery, processSearchResults, getWebSearchSystemInstruction } from "../utils/webSearch.js";
import { performWebSearch } from "../services/searchService.js";
import { convertFile } from "../utils/fileConversion.js";
import { generateVideoFromPrompt } from "../controllers/videoController.js";
import { generateImageFromPrompt } from "../controllers/image.controller.js";

import axios from "axios";


const router = express.Router();

// Helper to check guest limits
const checkGuestLimits = async (req, sessionId) => {
  if (req.user) return { allowed: true };
  if (!req.guest) return { allowed: true }; // Should not happen with middleware

  const MAX_SESSIONS = 1000;
  const MAX_MESSAGES = 1000;

  // 1. Check Sessions Count
  if (req.guest.sessionIds.length >= MAX_SESSIONS && !req.guest.sessionIds.includes(sessionId)) {
    return { allowed: false, reason: "MAX_SESSIONS_REACHED" };
  }

  // 2. Check Messages Count in current session if sessionId is provided
  if (sessionId) {
    const session = await ChatSession.findOne({ sessionId });
    if (session && session.messages && session.messages.length >= MAX_MESSAGES) {
      return { allowed: false, reason: "MAX_MESSAGES_REACHED" };
    }
  }

  return { allowed: true };
};

// Get all chat sessions (summary)
router.post("/", optionalVerifyToken, identifyGuest, async (req, res) => {
  const { content, history, systemInstruction, image, video, document, language, model, mode, sessionId } = req.body;

  try {
    // Enforce limits for guests
    const limitCheck = await checkGuestLimits(req, sessionId);
    if (!limitCheck.allowed) {
      return res.status(403).json({ error: "LIMIT_REACHED", reason: limitCheck.reason });
    }

    // --- MULTI-MODEL DISPATCHER ---
    if (model && !model.startsWith('gemini')) {
      try {
        let reply = "";

        // Standard OpenAI Format Preparation
        const formattedMessages = [
          { role: 'system', content: systemInstruction || "You are a helpful assistant." },
          ...(history || []).map(msg => ({
            role: msg.role === 'model' ? 'assistant' : 'user',
            content: msg.content
          })),
          { role: 'user', content: content }
        ];

        if (model.includes('groq')) {
          const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: formattedMessages
          }, { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
          reply = resp.data.choices[0].message.content;

        } else if (model.includes('openai')) {
          const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: formattedMessages
          }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
          reply = resp.data.choices[0].message.content;

        } else if (model.includes('kimi')) {
          const kimiModel = model.includes('k1.5') ? 'moonshot-v1-32k' : 'moonshot-v1-8k';
          const resp = await axios.post('https://api.moonshot.ai/v1/chat/completions', {
            model: kimiModel,
            messages: formattedMessages
          }, { headers: { Authorization: `Bearer ${process.env.KIMI_API_KEY}` } });
          reply = resp.data.choices[0].message.content;

        } else if (model.includes('claude')) {
          // Claude Specific Format
          const claudeMsgs = (history || []).map(msg => ({
            role: msg.role === 'model' ? 'assistant' : 'user',
            content: msg.content
          }));
          claudeMsgs.push({ role: 'user', content: content });

          const resp = await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-opus-20240229',
            max_tokens: 4096,
            system: systemInstruction,
            messages: claudeMsgs
          }, { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } });
          reply = resp.data.content[0].text;
        }


        return res.status(200).json({ reply });

      } catch (apiError) {
        console.error(`Error calling ${model}:`, apiError.response?.data || apiError.message);
        // Fallback: Do not return 500. Let it fall through to Gemini logic.
        // We will append a note to the final reply later if needed, or just let Gemini answer.
        console.log(`Falling back to Gemini due to ${model} failure.`);
      }
    }
    // Detect mode based on content and attachments
    const allAttachments = [];
    if (Array.isArray(image)) allAttachments.push(...image);
    else if (image) allAttachments.push(image);
    if (Array.isArray(document)) allAttachments.push(...document);
    else if (document) allAttachments.push(document);
    if (Array.isArray(video)) allAttachments.push(...video);
    else if (video) allAttachments.push(video);

    let detectedMode = mode || detectMode(content, allAttachments);
    if (detectedMode === 'DOCUMENT_CONVERT') detectedMode = 'FILE_CONVERSION';
    const modeSystemInstruction = getModeSystemInstruction(detectedMode, language || 'English', {
      fileCount: allAttachments.length
    });

    console.log(`[MODE DETECTION] Detected mode: ${detectedMode} for message: "${content?.substring(0, 50)}..."`);

    // Construct parts from history + current message
    let parts = [];

    // Use mode-specific system instruction, or fallback to provided systemInstruction
    // CRITICAL: FILE_CONVERSION instructions must take priority over frontend generic prompts
    let finalSystemInstruction = systemInstruction || modeSystemInstruction;
    if (detectedMode === 'FILE_CONVERSION' || detectedMode === 'FILE_ANALYSIS') {
      finalSystemInstruction = modeSystemInstruction;
    } else {
      // Only add standard rules for non-specialized modes to avoid instruction collision
      const MANDATORY_JSON_RULES = `
MANDATORY: If the user asks to GENERATE AN IMAGE, output ONLY:
{"action": "generate_image", "prompt": "detailed description"}

MANDATORY: If the user asks to GENERATE A VIDEO, output ONLY:
{"action": "generate_video", "prompt": "detailed description"}

Do not output any other text or explanation if you are triggering these actions.`;
      finalSystemInstruction = `${finalSystemInstruction}\n\n${MANDATORY_JSON_RULES}`;
    }

    // Add conversation history if available
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        parts.push({ text: `${msg.role === 'user' ? 'User' : 'Model'}: ${msg.content}` });
      });
    }

    // Add current message
    parts.push({ text: `User: ${content}` });

    // Handle Multiple Images
    if (Array.isArray(image)) {
      image.forEach(img => {
        if (img.mimeType && img.base64Data) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64Data
            }
          });
        }
      });
    } else if (image && image.mimeType && image.base64Data) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64Data
        }
      });
    }

    // Handle Multiple Videos
    if (Array.isArray(video)) {
      video.forEach(vid => {
        if (vid.mimeType && vid.base64Data) {
          parts.push({
            inlineData: {
              mimeType: vid.mimeType,
              data: vid.base64Data
            }
          });
        }
      });
    } else if (video && video.mimeType && video.base64Data) {
      parts.push({
        inlineData: {
          mimeType: video.mimeType,
          data: video.base64Data
        }
      });
    }

    // Handle Multiple Documents
    if (Array.isArray(document)) {
      for (const doc of document) {
        await processDocumentPart(doc, parts);
      }
    } else if (document && document.base64Data) {
      await processDocumentPart(document, parts);
    }

    async function processDocumentPart(doc, partsArray) {
      const mimeType = doc.mimeType || 'application/pdf';

      // For PDF documents, we can pass binary data directly to Gemini
      if (mimeType === 'application/pdf') {
        partsArray.push({
          inlineData: {
            data: doc.base64Data,
            mimeType: mimeType
          }
        });
      }

      // Extract text for all document types (Word, etc.)
      if (mimeType.includes('word') || mimeType.includes('officedocument') || mimeType.includes('text')) {
        try {
          const buffer = Buffer.from(doc.base64Data, 'base64');
          const result = await mammoth.extractRawText({ buffer });
          if (result.value) {
            partsArray.push({ text: `[Fallback Text Content of ${doc.name || 'document'}]:\n${result.value}` });
          }
        } catch (e) {
          console.warn("Text extraction fallback failed, using binary only", e.message);
        }
      } else if (doc.mimeType && (doc.mimeType.includes('text') || doc.mimeType.includes('spreadsheet') || doc.mimeType.includes('presentation'))) {
        try {
          const buffer = Buffer.from(doc.base64Data, 'base64');
          let text = `[Attached File: ${doc.name || 'document'}]`;
          if (doc.mimeType.includes('spreadsheet') || doc.mimeType.includes('excel')) {
            // Basic indicator for excel, complex parsing omitted for brevity
            text = `[Attached Spreadsheet: ${doc.name || 'document'}]`;
          }
          partsArray.push({ text: `[Attached Document Content (${doc.name || 'document'})]:\n${text}` });
        } catch (e) {
          console.error("Extraction failed", e);
          partsArray.push({ text: `[Error reading attached document: ${e.message}]` });
        }
      }
    }

    // Voice Assistant: Detect intent for reminder/alarm
    const userIntent = detectIntent(content);
    const detectedLanguage = detectLanguage(content);
    let reminderData = null;
    let voiceConfirmation = '';

    console.log(`[VOICE ASSISTANT] Intent: ${userIntent}, Language: ${detectedLanguage}`);

    // If intent is reminder/alarm related, extract details and create reminder
    if (userIntent !== 'casual_chat' && userIntent !== 'clarification_needed') {
      try {
        reminderData = extractReminderDetails(content);
        console.log('[VOICE ASSISTANT] Reminder details:', reminderData);

        // Save reminder to database
        if (req.user) {
          // Save reminder to database (Only for logged-in users)
          const newReminder = new Reminder({
            userId: req.user.id,
            title: reminderData.title,
            datetime: reminderData.datetime,
            notification: reminderData.notification,
            alarm: reminderData.alarm,
            voice: reminderData.voice,
            voiceMessage: reminderData.voice_message,
            intent: reminderData.intent
          });
          await newReminder.save();
          console.log('[VOICE ASSISTANT] Reminder saved to DB:', newReminder._id);

          // Generate voice-friendly confirmation
          const time = new Date(reminderData.datetime).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          const date = new Date(reminderData.datetime).toLocaleDateString('en-IN');

          if (detectedLanguage === 'Hinglish' || detectedLanguage === 'Hindi') {
            voiceConfirmation = `Okay, main ${time} par ${reminderData.alarm ? 'alarm aur ' : ''}${reminderData.voice ? 'voice ke saath ' : ''}reminder set kar dungi`;
          } else {
            voiceConfirmation = `Okay, I'll set a ${reminderData.alarm ? 'alarm and ' : ''}${reminderData.voice ? 'voice ' : ''}reminder for ${time}`;
          }
        } else {
          console.log('[VOICE ASSISTANT] Guest user - skipping reminder save.');
          voiceConfirmation = "I can only set reminders for logged-in users. Please log in to use this feature.";
        }
      } catch (error) {
        console.error('[VOICE ASSISTANT] Error extracting/saving reminder:', error);
      }
    }

    console.log("[DEBUG] Starting Web Search check...");
    let searchResults = null;
    let webSearchInstruction = '';
    const isDeepSearch = systemInstruction && systemInstruction.includes('DEEP SEARCH MODE ENABLED');

    if (requiresWebSearch(content) || isDeepSearch) {
      console.log(`[WEB SEARCH] Query requires real-time information${isDeepSearch ? ' (Forced by Deep Search)' : ''}`);
      try {
        const searchQuery = extractSearchQuery(content);
        console.log(`[WEB SEARCH] Searching for: "${searchQuery}"`);

        const rawSearchData = await performWebSearch(searchQuery, isDeepSearch ? 10 : 5);
        if (rawSearchData) {
          const limit = isDeepSearch ? 10 : 5;
          searchResults = processSearchResults(rawSearchData, limit);
          console.log(`[WEB SEARCH] Found ${searchResults.snippets.length} results`);

          webSearchInstruction = getWebSearchSystemInstruction(searchResults, language || 'English', isDeepSearch);
          parts.push({ text: `[WEB SEARCH RESULTS]:\n${JSON.stringify(searchResults.snippets)}` });
          parts.push({ text: `[SEARCH INSTRUCTION]: ${webSearchInstruction}` });
        }
      } catch (error) {
        console.error('[WEB SEARCH ERROR]', error);
      }
    }
    console.log("[DEBUG] Web Search check complete.");

    // File Conversion: Check if this is a conversion request
    let conversionResult = null;

    if (detectedMode === 'FILE_CONVERSION') {
      console.log('[FILE CONVERSION] Conversion request detected');
      console.log(`[FILE CONVERSION] Attachments count: ${allAttachments.length}`);

      // First, get AI response to extract conversion parameters
      // We pass the full parts + explicit instruction to be super clear
      let aiResponse = "";
      try {
        const tempContentPayload = { role: "user", parts: parts };
        const modelForParams = genAIInstance.getGenerativeModel({
          model: primaryModelName,
          systemInstruction: finalSystemInstruction
        });

        const tempStreamingResult = await modelForParams.generateContent({
          contents: [tempContentPayload],
          generationConfig: { maxOutputTokens: 1024 }
        });
        const tempResponse = await tempStreamingResult.response;

        if (typeof tempResponse.text === 'function') {
          aiResponse = await tempResponse.text();
        } else if (tempResponse.candidates?.[0]?.content?.parts?.[0]?.text) {
          aiResponse = tempResponse.candidates[0].content.parts[0].text;
        }
        console.log('[FILE CONVERSION] AI Response:', aiResponse);
      } catch (e) {
        console.error('[FILE CONVERSION] Failed to get AI parameters (will use fallback):', e.message);
      }

      // Try to extract JSON from AI response (handle markdown backticks too)
      let jsonMatch = null;
      let conversionParams = null;

      // 1. Try Code Block Regex
      const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"action":\s*"file_conversion"[\s\S]*?\})\s*```/;
      const codeBlockMatch = aiResponse.match(codeBlockRegex);

      if (codeBlockMatch) {
        try {
          conversionParams = JSON.parse(codeBlockMatch[1]);
          jsonMatch = { 1: codeBlockMatch[1] }; // Mock match object for existing logic compatibility
        } catch (e) { console.warn("[FILE CONVERSION] Code block parse failed", e); }
      }

      // 2. Try Raw JSON Regex (if no code block)
      if (!conversionParams) {
        const rawJsonRegex = /(\{[\s\S]*?"action":\s*"file_conversion"[\s\S]*?\})/;
        const rawMatch = aiResponse.match(rawJsonRegex);
        if (rawMatch) {
          try {
            conversionParams = JSON.parse(rawMatch[1]);
            jsonMatch = { 1: rawMatch[1] };
          } catch (e) { console.warn("[FILE CONVERSION] Raw regex parse failed", e); }
        }
      }

      // 3. Fallback: Find first '{' and last '}'
      if (!conversionParams) {
        try {
          const firstBrace = aiResponse.indexOf('{');
          const lastBrace = aiResponse.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace > firstBrace) {
            const potentialJson = aiResponse.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(potentialJson);
            if (parsed.action === 'file_conversion') {
              conversionParams = parsed;
              jsonMatch = { 1: potentialJson };
            }
          }
        } catch (e) {
          console.warn("[FILE CONVERSION] Fallback parse failed", e);
        }
      }

      // --- DETERMINISTIC FALLBACK (If AI extracted nothing) ---
      if (!conversionParams && allAttachments.length > 0) {
        console.warn("[FILE CONVERSION] AI failed to extract params. Using deterministic logic.");
        const att = allAttachments[0];
        const name = att.name || 'document';
        const ext = name.split('.').pop().toLowerCase();

        let target = 'pdf';
        let source = ext;

        if (ext === 'pdf') target = 'docx';
        else if (['doc', 'docx'].includes(ext)) target = 'pdf';
        else if (['jpg', 'jpeg', 'png', 'webp', 'xls', 'xlsx'].includes(ext)) target = 'pdf';

        conversionParams = {
          action: "file_conversion",
          source_format: source,
          target_format: target,
          file_name: name
        };
        console.log(`[FILE CONVERSION] Fallback Params: ${source} -> ${target}`);
      }

      if (conversionParams && allAttachments.length > 0) {
        try {
          console.log('[FILE CONVERSION] Parsed params:', conversionParams);

          // Get the first attachment (assuming single file conversion)
          const attachment = allAttachments[0];

          // Convert base64 to buffer
          const base64Data = attachment.base64Data || attachment.data;

          if (!base64Data) {
            throw new Error('No file data received for conversion');
          }

          const fileBuffer = Buffer.from(base64Data, 'base64');

          // Perform conversion
          const convertedBuffer = await convertFile(
            fileBuffer,
            conversionParams.source_format,
            conversionParams.target_format
          );

          // Convert result to base64
          const convertedBase64 = convertedBuffer.toString('base64');

          // Determine output filename
          const originalName = conversionParams.file_name || 'document';
          const baseName = originalName.replace(/\.(pdf|docx?|doc)$/i, '');
          const outputExtension = conversionParams.target_format === 'pdf' ? 'pdf' : 'docx';
          const outputFileName = `${baseName}_converted.${outputExtension}`;

          conversionResult = {
            success: true,
            file: convertedBase64,
            fileName: outputFileName,
            mimeType: conversionParams.target_format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            message: (jsonMatch && jsonMatch[1])
              ? aiResponse.replace(jsonMatch[1], '').replace(/```json|```/g, '').trim()
              : "Here is your converted document."
          };

          console.log('[FILE CONVERSION] Conversion successful:', outputFileName);

        } catch (conversionError) {
          console.error('[FILE CONVERSION] Conversion failed:', conversionError);
          conversionResult = {
            success: false,
            error: conversionError.message
          };
        }
      } else {
        console.log('[FILE CONVERSION] NO JSON MATCH found in AI response. AI said:', aiResponse.substring(0, 200));
        conversionResult = {
          success: false,
          error: "AI did not trigger conversion parameters. Please be more specific (e.g., 'Convert this to PDF')."
        };
      }
    }

    // Correct usage for single-turn content generation with this SDK
    const contentPayload = { role: "user", parts: parts };

    let reply = "";
    let retryCount = 0;
    const maxRetries = 3;

    const attemptGeneration = async () => {
      console.log("[GEMINI] Starting generation attempt...");

      const tryModel = async (mName) => {
        try {
          console.log(`[GEMINI] Trying model: ${mName}`);
          // Always create fresh model instance with correct system instruction
          const model = genAIInstance.getGenerativeModel({
            model: mName,
            systemInstruction: finalSystemInstruction
          });

          // Add timeout to prevent hanging (60 seconds)
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 60000));
          const resultPromise = model.generateContent({ contents: [contentPayload] });

          const result = await Promise.race([resultPromise, timeoutPromise]);
          const response = await result.response;
          let text = '';
          if (typeof response.text === 'function') {
            text = response.text();
          } else if (response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
            text = response.candidates[0].content.parts[0].text;
          }
          if (text) return text;
          throw new Error("Empty response");
        } catch (mErr) {
          console.error(`[GEMINI] Model ${mName} failed:`, mErr.message);
          throw mErr;
        }
      };

      try {
        // Use the model from vertex.js config
        return await tryModel(primaryModelName);
      } catch (err) {
        throw new Error(`Model generation failed: ${err.message}`);
      }
    };

    // --- SKIP GENERATION IF CONVERSION SUCCESSFUL ---
    if (conversionResult && conversionResult.success) {
      console.log("[CHAT] Conversion successful, skipping text generation.");
      reply = conversionResult.message || "Here is your converted document.";
    } else {
      while (retryCount < maxRetries) {
        try {
          reply = await attemptGeneration();
          break; // Success!
        } catch (err) {
          if (err.status === 429 && retryCount < maxRetries - 1) {
            retryCount++;
            const waitTime = Math.pow(2, retryCount) * 1000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw err;
        }
      }
    }

    if (!reply) {
      reply = "I understood your request but couldn't generate a text response.";
    }

    // Construct final response object
    const finalResponse = {
      reply,
      detectedMode,
      language: detectedLanguage || language || 'English'
    };

    // Check for Media (Video/Image) Generation Action
    // Check for Media (Video/Image) Generation Action
    try {
      console.log(`[MEDIA GEN] Analyzing reply: "${reply.substring(0, 100)}..."`);

      // Helper to extract JSON object with balanced braces
      const extractActionJson = (text) => {
        // 1. Try to anchor on "action": "..." (support single/double quotes)
        // We match strictly to avoid false positives, but allow slight whitespace variance
        const anchorRegex = /["']action["']\s*:\s*["'](generate_video|generate_image)["']/;
        const actionMatch = text.match(anchorRegex);

        if (actionMatch) {
          const actionIndex = actionMatch.index;
          // Find the starting brace '{' before the action
          let startIndex = text.lastIndexOf('{', actionIndex);

          if (startIndex !== -1) {
            // Attempt balanced brace counting
            let openBraces = 0;
            let endIndex = -1;
            let inString = false;
            let escape = false;

            for (let i = startIndex; i < text.length; i++) {
              const char = text[i];
              if (escape) { escape = false; continue; }
              if (char === '\\') { escape = true; continue; }
              if (char === '"' || char === "'") { inString = !inString; continue; } // Simplistic quote handling

              if (!inString) {
                if (char === '{') {
                  openBraces++;
                } else if (char === '}') {
                  openBraces--;
                  if (openBraces === 0) {
                    endIndex = i + 1;
                    break;
                  }
                }
              }
            }

            if (endIndex !== -1) {
              const jsonStr = text.substring(startIndex, endIndex);
              try {
                const parsed = JSON.parse(jsonStr); // Strict JSON header check
                return { data: parsed, raw: jsonStr };
              } catch (e) {
                // Try loose parsing (e.g. if keys are not quoted or single quoted)
                // We can't use eval safely, but we can try simple regex extraction if strict parse failed
                console.warn("[MEDIA GEN] Strict JSON parse failed, trying fallback regex extraction...");
              }
            }
          }
        }

        // 2. Fallback: classic greedy Regex (works for 99% of simple cases)
        // Matches { ... "action": "generate_video" ... }
        const simpleRegex = /\{[\s\S]*?["']action["']\s*:\s*["'](generate_video|generate_image)["'][\s\S]*?\}/;
        const simpleMatch = text.match(simpleRegex);
        if (simpleMatch) {
          try {
            return { data: JSON.parse(simpleMatch[0]), raw: simpleMatch[0] };
          } catch (e) {
            console.error("[MEDIA GEN] Fallback regex matched but parse failed:", e.message);
          }
        }

        // 3. Fallback for Array format [ { ... } ]
        const arrayRegex = /\[\s*\{[\s\S]*?["']action["']\s*:\s*["'](generate_video|generate_image)["'][\s\S]*?\}\s*\]/;
        const arrayMatch = text.match(arrayRegex);
        if (arrayMatch) {
          try {
            const arr = JSON.parse(arrayMatch[0]);
            if (Array.isArray(arr) && arr[0]) {
              return { data: arr[0], raw: arrayMatch[0] };
            }
          } catch (e) {
            console.error("[MEDIA GEN] Array regex matched but parse failed:", e.message);
          }
        }

        return null;
      };

      const extracted = extractActionJson(reply);

      if (extracted) {
        const { data, raw } = extracted;
        console.log(`[MEDIA GEN] Found trigger JSON: ${raw}`);

        // REMOVE processed JSON from the reply text immediately
        reply = reply.replace(raw, '').trim();

        if (data.action === 'generate_video' && data.prompt) {
          console.log(`[VIDEO GEN] Calling generator for: ${data.prompt}`);
          const videoUrl = await generateVideoFromPrompt(data.prompt, 5, 'medium');
          if (videoUrl) {
            finalResponse.videoUrl = videoUrl;
            finalResponse.reply = (reply && reply.trim()) ? reply : `Sure, I've generated a video based on your request: "${data.prompt.substring(0, 50)}..."`;
          } else {
            finalResponse.reply = (reply && reply.trim()) ? reply : "I attempted to generate a video but encountered an error.";
          }
        }
        else if (data.action === 'generate_image' && data.prompt) {
          console.log(`[IMAGE GEN] Calling generator for: ${data.prompt}`);
          // Use a shorter version of prompt for Fallback just in case
          const safePrompt = data.prompt.length > 400 ? data.prompt.substring(0, 400) : data.prompt;

          try {
            const imageUrl = await generateImageFromPrompt(data.prompt);
            if (imageUrl) {
              finalResponse.imageUrl = imageUrl;
              // Ensure reply is set, fallback to default if empty
              finalResponse.reply = (reply && reply.trim()) ? reply : "Here is the image you requested.";
            }
          } catch (imgError) {
            console.warn(`[IMAGE GEN] Vertex failed. Falling back to Pollinations.`);
            const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(safePrompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}&model=flux`;
            finalResponse.imageUrl = pollinationsUrl;
            finalResponse.reply = (reply && reply.trim()) ? reply : "I've generated this image for you using my fallback engine.";
          }
        }
      }

      // 2. Check for Markdown Image triggers (Support frontend instructions)
      if (!finalResponse.imageUrl) {
        const mdImageRegex = /!\[Image\]\((https:\/\/image\.pollinations\.ai\/prompt\/([^?)]+)[^)]*)\)/;
        const mdMatch = reply.match(mdImageRegex);
        if (mdMatch) {
          console.log("[MEDIA GEN] Found Pollinations markdown trigger.");
          finalResponse.imageUrl = mdMatch[1];
          // Remove the markdown tag from text to avoid double display
          reply = reply.replace(mdMatch[0], '').trim();
          finalResponse.reply = (reply && reply.trim()) ? reply : "Here is the image you requested.";
        }
      }

      // Final cleanup: Remove backticks if the model output the JSON inside a code block
      reply = reply.replace(/```json\s*```|```\s*```/g, '').trim();
      // Ensure finalResponse.reply has a value if we didn't hit the blocks above
      if (!finalResponse.reply && !finalResponse.imageUrl && !finalResponse.videoUrl) {
        finalResponse.reply = reply || "Processed your request.";
      } else if (!finalResponse.reply) {
        finalResponse.reply = reply; // Sync back just in case
      }

    } catch (e) {
      console.warn("[MEDIA GEN] Critical failure in media handling logic:", e);
    }

    if (voiceConfirmation) {
      finalResponse.voiceConfirmation = voiceConfirmation;
    }

    if (conversionResult) {
      if (conversionResult.success) {
        finalResponse.conversion = {
          file: conversionResult.file,
          fileName: conversionResult.fileName,
          mimeType: conversionResult.mimeType
        };
        finalResponse.reply = conversionResult.message || reply;
      } else {
        finalResponse.reply = `Conversion failed: ${conversionResult.error}`;
      }
    }

    return res.status(200).json(finalResponse);
  } catch (err) {
    if (mongoose.connection.readyState !== 1) {
      console.warn('[DB] MongoDB unreachable during generation. Returning translation key.');
      return res.status(200).json({ reply: "dbDemoModeMessage", detectedMode: 'NORMAL_CHAT' });
    }
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

    console.error("AISA backend error details:", {
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err.details || err.response?.data
    });
    const statusCode = err.status || 500;
    return res.status(statusCode).json({ error: "AI failed to respond", details: err.message });
  }
});
// Get all chat sessions (summary) for the authenticated user or guest
router.get('/', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const userId = req.user?.id;
    const guestId = req.guest?.guestId;

    if (!userId && !guestId) {
      return res.json([]);
    }

    // Check DB connection
    if (mongoose.connection.readyState !== 1) {
      console.warn('[DB] MongoDB unreachable. Returning empty sessions.');
      return res.json([]);
    }

    let sessions = [];

    if (userId) {
      const user = await userModel.findById(userId).populate({
        path: 'chatSessions',
        select: 'sessionId title lastModified userId',
        options: { sort: { lastModified: -1 } }
      });
      sessions = (user?.chatSessions || []).filter(s => s !== null);
    } else if (guestId) {
      sessions = await ChatSession.find({ guestId })
        .select('sessionId title lastModified guestId')
        .sort({ lastModified: -1 });
    }

    res.json(sessions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get chat history for a specific session
router.get('/:sessionId', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id;
    const guestId = req.guest?.guestId;

    // Check DB connection
    if (mongoose.connection.readyState !== 1) {
      console.warn('[DB] MongoDB unreachable. Returning empty history.');
      return res.json({ sessionId, messages: [] });
    }

    // Verify that the session belongs to this user or guest
    let session = await ChatSession.findOne({ sessionId });

    if (!session) {
      console.warn(`[CHAT] Session ${sessionId} not found in DB.`);
      return res.status(404).json({ message: 'Session not found' });
    }

    // Ownership check
    if (userId) {
      if (session.userId && session.userId.toString() !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      // If session is unowned, try to link it to the logged-in user
      if (!session.userId) {
        const currentGuestId = req.cookies.guest_id;
        const fingerprint = req.headers['x-device-fingerprint'];

        let canLink = (session.guestId === currentGuestId);

        if (!canLink && fingerprint) {
          const guestByFingerprint = await Guest.findOne({ fingerprint });
          if (guestByFingerprint && guestByFingerprint.guestId === session.guestId) {
            canLink = true;
          }
        }

        // Emergency fallback: If it's a guest session and user is accessing it right after login
        // we can be slightly more lenient if needed, but fingerprint/cookie covers most cases.

        if (canLink || !session.guestId) { // !session.guestId handles legacy/edge cases
          session.userId = userId;
          await session.save();
          await userModel.findByIdAndUpdate(userId, { $addToSet: { chatSessions: session._id } });
          console.log(`[CHAT] Linked guest session ${sessionId} to user ${userId}`);
        }
      }
    } else if (guestId) {
      if (session.guestId !== guestId) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`[CHAT] Found session ${sessionId} with ${session.messages?.length || 0} messages.`);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Create or Update message in session
router.post('/:sessionId/message', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message, title } = req.body;
    const userId = req.user?.id;
    const guest = req.guest;

    if (!message?.role || !message?.content) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    // Enforce limits for guests
    const limitCheck = await checkGuestLimits(req, sessionId);
    if (!limitCheck.allowed) {
      return res.status(403).json({ error: "LIMIT_REACHED", reason: limitCheck.reason });
    }

    // Cloudinary Upload Logic for Multiple Attachments
    if (message.attachments && Array.isArray(message.attachments)) {
      for (const attachment of message.attachments) {
        if (attachment.url && attachment.url.startsWith('data:')) {
          try {
            const matches = attachment.url.match(/^data:(.+);base64,(.+)$/);
            if (matches) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');

              // Upload to Cloudinary
              const uploadResult = await uploadToCloudinary(buffer, {
                resource_type: 'auto',
                folder: 'chat_attachments',
                public_id: `chat_${sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
              });

              // Update attachment with Cloudinary URL
              attachment.url = uploadResult.secure_url;
            }
          } catch (uploadError) {
            console.error("Cloudinary upload failed for attachment:", uploadError);
          }
        }
      }
    }

    // Check DB connection
    if (mongoose.connection.readyState !== 1) {
      console.warn('[DB] MongoDB unreachable. Skipping message save.');
      return res.json({ sessionId, messages: [message], dummy: true });
    }

    // Ownership check before saving
    let existingSession = await ChatSession.findOne({ sessionId });
    if (existingSession) {
      if (userId) {
        if (existingSession.userId && existingSession.userId.toString() !== userId) {
          return res.status(403).json({ error: "Access denied" });
        }
        if (!existingSession.userId && existingSession.guestId) {
          const currentGuestId = req.cookies.guest_id;
          const fingerprint = req.headers['x-device-fingerprint'];
          let canLink = (existingSession.guestId === currentGuestId);
          if (!canLink && fingerprint) {
            const guestByFingerprint = await Guest.findOne({ fingerprint });
            if (guestByFingerprint && guestByFingerprint.guestId === existingSession.guestId) {
              canLink = true;
            }
          }
          if (!canLink) return res.status(403).json({ error: "Access denied" });
        }
      } else if (guest) {
        if (existingSession.guestId && existingSession.guestId !== guest.guestId) {
          return res.status(403).json({ error: "Access denied" });
        }
      }
    }

    const updateData = {
      $push: { messages: message },
      $set: {
        lastModified: Date.now(),
        ...(title && { title })
      }
    };

    if (userId) {
      updateData.$set.userId = userId;
    } else if (guest) {
      updateData.$set.guestId = guest.guestId;
    }

    const session = await ChatSession.findOneAndUpdate(
      { sessionId },
      updateData,
      { new: true, upsert: true }
    );

    // Update guest's sessionIds tracker if guest session
    if (guest && !guest.sessionIds.includes(sessionId)) {
      guest.sessionIds.push(sessionId);
      await guest.save();
    }

    // If logged in, associate with user profile
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      await userModel.findByIdAndUpdate(
        userId,
        { $addToSet: { chatSessions: session._id } },
        { new: true }
      );
      console.log(`[CHAT] Associated session ${session._id} with user ${userId}.`);
    }

    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});


// Delete individual message from session
router.delete('/:sessionId/message/:messageId', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const { sessionId, messageId } = req.params;
    const userId = req.user?.id;
    const guestId = req.guest?.guestId;

    // Optional: Also delete the subsequent model response if it exists
    const session = await ChatSession.findOne({ sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Ownership Check
    if (userId && session.userId && session.userId.toString() !== userId) return res.status(403).json({ error: "Access denied" });
    if (guestId && session.guestId && session.guestId !== guestId) return res.status(403).json({ error: "Access denied" });
    if (!userId && !guestId) return res.status(401).json({ error: "Unauthorized" });

    const msgIndex = session.messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return res.status(404).json({ error: 'Message not found' });

    const msgsToDelete = [messageId];
    if (msgIndex + 1 < session.messages.length) {
      const nextMsg = session.messages[msgIndex + 1];
      if (nextMsg && nextMsg.role === 'model' && nextMsg.id) {
        msgsToDelete.push(nextMsg.id);
      }
    }

    const validMsgsToDelete = msgsToDelete.filter(id => id);
    console.log(`[DELETE] Session: ${sessionId}, Removing IDs:`, validMsgsToDelete);

    if (validMsgsToDelete.length > 0) {
      await ChatSession.findOneAndUpdate(
        { sessionId },
        { $pull: { messages: { id: { $in: validMsgsToDelete } } } }
      );
    }

    res.json({ success: true, removedCount: validMsgsToDelete.length });
  } catch (err) {
    console.error(`[DELETE ERROR] Session: ${req.params.sessionId}, Msg: ${req.params.messageId}`, err);
    res.status(500).json({ error: 'Failed to delete message', details: err.message });
  }
});

// (The POST /:sessionId/message route is defined above around line 702)

// Update chat session title
router.patch('/:sessionId/title', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    const userId = req.user?.id;
    const guestId = req.guest?.guestId;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    if (mongoose.connection.readyState !== 1) {
      console.warn('[DB] MongoDB unreachable during rename.');
      return res.status(503).json({ error: 'Database unavailable' });
    }

    // Build query based on user or guest
    const query = { sessionId };
    if (userId) query.userId = userId;
    else if (guestId) query.guestId = guestId;
    else return res.status(401).json({ error: "Unauthorized" });

    const session = await ChatSession.findOneAndUpdate(
      query,
      { $set: { title, lastModified: Date.now() } },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Session not found or access denied' });
    }

    console.log(`[CHAT] Successfully renamed session ${sessionId} to "${title}"`);
    res.json(session);
  } catch (err) {
    console.error(`[CHAT RENAME ERROR] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:sessionId', optionalVerifyToken, identifyGuest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id;
    const guestId = req.guest?.guestId;

    const query = { sessionId };
    if (userId) query.userId = userId;
    else if (guestId) query.guestId = guestId;
    else return res.status(401).json({ error: "Unauthorized" });

    const session = await ChatSession.findOneAndDelete(query);
    if (session && userId) {
      await userModel.findByIdAndUpdate(userId, { $pull: { chatSessions: session._id } });
    } else if (session && guestId) {
      // Guest session deleted
      const guest = await Guest.findOne({ guestId });
      if (guest) {
        guest.sessionIds = guest.sessionIds.filter(id => id !== sessionId);
        await guest.save();
      }
    }
    res.json({ message: 'History cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
