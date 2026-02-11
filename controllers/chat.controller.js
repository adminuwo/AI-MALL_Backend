import * as aiService from '../services/ai.service.js';
import logger from '../utils/logger.js';
import Conversation from '../models/Conversation.model.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import officeParser from 'officeparser';
import Tesseract from 'tesseract.js';


// @desc    Chat with AI
// @route   POST /api/chat
// @access  Public (for now)
export const chat = async (req, res, next) => {
    try {
        const { message, conversationId, activeDocContent, systemInstruction, mode, image, document } = req.body;

        if (!message && (!image || image.length === 0) && (!document || document.length === 0)) {
            return res.status(400).json({ success: false, message: 'Message or attachment is required' });
        }

        // 1. Get AI Response (Pass detailed context)
        const responseText = await aiService.chat(message, activeDocContent, {
            systemInstruction,
            mode,
            images: image,
            documents: document
        });

        // 2. Persist to DB
        let conversation;
        if (conversationId) {
            conversation = await Conversation.findById(conversationId);
        }

        if (!conversation) {
            conversation = new Conversation({
                userId: 'admin', // Hardcoded for now
                title: message.substring(0, 30) + (message.length > 30 ? '...' : ''), // Auto-title
                messages: []
            });
        }

        conversation.messages.push({ role: 'user', text: message });
        conversation.messages.push({ role: 'assistant', text: responseText });
        conversation.lastMessageAt = Date.now();
        await conversation.save();

        res.status(200).json({
            success: true,
            data: responseText,
            conversationId: conversation._id
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Upload attachment for Chat (Temporary Context)
// @route   POST /api/chat/upload
// @access  Public
export const uploadAttachment = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const fileBuffer = req.file.buffer;
        const mimeType = req.file.mimetype;
        let parsedText = null;

        // Extract Text for Immediate Context
        if (mimeType === 'application/pdf') {
            try {
                const data = await pdf(fileBuffer);
                parsedText = data.text;
                logger.info(`[Chat Upload] Parsed PDF: ${data.numpages} pages.`);
            } catch (e) {
                logger.error(`[Chat Upload] PDF parse error: ${e.message}`);
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            try {
                const result = await mammoth.extractRawText({ buffer: fileBuffer });
                parsedText = result.value;
                logger.info(`[Chat Upload] Parsed DOCX: ${parsedText.length} chars.`);
            } catch (e) {
                logger.error(`[Chat Upload] DOCX parse error: ${e.message}`);
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            try {
                const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
                parsedText = workbook.SheetNames.map(name => {
                    return xlsx.utils.sheet_to_text(workbook.Sheets[name]);
                }).join('\n\n');
                logger.info(`[Chat Upload] Parsed Excel.`);
            } catch (e) {
                logger.error(`[Chat Upload] Excel parse error: ${e.message}`);
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            try {
                parsedText = await officeParser.parse(fileBuffer);
                logger.info(`[Chat Upload] Parsed PPTX.`);
            } catch (e) {
                logger.error(`[Chat Upload] PPTX parse error: ${e.message}`);
            }
        } else if (mimeType.startsWith('image/')) {
            try {
                logger.info(`[Chat Upload] Starting OCR...`);
                const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng');
                parsedText = text;
                logger.info(`[Chat Upload] OCR Complete: ${parsedText.length} chars.`);
            } catch (e) {
                logger.error(`[Chat Upload] OCR error: ${e.message}`);
            }
        } else if (mimeType === 'text/plain') {
            parsedText = fileBuffer.toString('utf8');
        }

        // Helper to upload to cloudinary for visual reference (image/pdf link)
        const cloudResult = await uploadToCloudinary(fileBuffer, {
            resource_type: 'auto',
            public_id: 'chat_upload_' + Date.now()
        });

        // Return text so frontend can send it back as context
        res.status(200).json({
            success: true,
            data: {
                url: cloudResult.secure_url,
                mimetype: mimeType,
                filename: req.file.originalname,
                size: req.file.size,
                parsedText: parsedText // Frontend stores this in state
            }
        });
    } catch (error) {
        next(error);
    }
};


// @desc    Get all conversations
// @route   GET /api/chat/history
// @access  Public
export const getHistory = async (req, res, next) => {
    try {
        const query = { userId: 'admin' };

        if (req.query.search) {
            const searchRegex = new RegExp(req.query.search, 'i');
            query.$or = [
                { title: searchRegex },
                { 'messages.text': searchRegex }
            ];
        }

        const conversations = await Conversation.find(query)
            .sort({ lastMessageAt: -1 })
            .select('title lastMessageAt createdAt');

        res.status(200).json({
            success: true,
            data: conversations
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get specific conversation
// @route   GET /api/chat/:id
// @access  Public
export const getConversation = async (req, res, next) => {
    try {
        const conversation = await Conversation.findById(req.params.id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        res.status(200).json({
            success: true,
            data: conversation
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete a conversation
// @route   DELETE /api/chat/:id
// @access  Public
export const deleteConversation = async (req, res, next) => {
    try {
        const conversation = await Conversation.findById(req.params.id);
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }

        await Conversation.findByIdAndDelete(req.params.id);

        res.status(200).json({
            success: true,
            message: 'Conversation deleted'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Clear all history
// @route   DELETE /api/chat/history
// @access  Public
export const clearHistory = async (req, res, next) => {
    try {
        await Conversation.deleteMany({ userId: 'admin' }); // Clear for current user

        res.status(200).json({
            success: true,
            message: 'History cleared'
        });
    } catch (error) {
        next(error);
    }
};
