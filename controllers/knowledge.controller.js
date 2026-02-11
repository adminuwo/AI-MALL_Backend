import logger from '../utils/logger.js';
import path from 'path';
import stream from 'stream';
import util from 'util';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import Knowledge from '../models/Knowledge.model.js';
import * as aiService from '../services/ai.service.js';
import { uploadToCloudinary } from '../services/cloudinary.service.js';
import mammoth from 'mammoth';
import xlsx from 'xlsx';
import officeParser from 'officeparser';
import Tesseract from 'tesseract.js';

const pipeline = util.promisify(stream.pipeline);

// @desc    Upload a document
// @route   POST /api/knowledge/upload
// @access  Public
export const uploadDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const fileBuffer = req.file.buffer;
        const originalName = req.file.originalname;
        const mimeType = req.file.mimetype;
        const fileSize = req.file.size;

        logger.info(`Processing file in memory: ${originalName} (${fileSize} bytes)`);

        let textContent = '';
        let cloudinaryResult = null;

        // 1. Process Content (In-Memory)
        if (mimeType === 'application/pdf') {
            try {
                const data = await pdf(fileBuffer);
                textContent = data.text;
                logger.info(`Parsed PDF with ${data.numpages} pages`);
            } catch (pdfError) {
                logger.error(`PDF Parsing Failed: ${pdfError.message}`);
                textContent = "PDF parsing failed. Document stored without text context.";
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            try {
                const result = await mammoth.extractRawText({ buffer: fileBuffer });
                textContent = result.value;
                logger.info(`Parsed DOCX: ${textContent.length} chars.`);
            } catch (docxError) {
                logger.error(`DOCX Parsing Failed: ${docxError.message}`);
                textContent = "DOCX parsing failed.";
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            try {
                const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
                const sheetNames = workbook.SheetNames;
                textContent = sheetNames.map(name => {
                    const sheet = workbook.Sheets[name];
                    return xlsx.utils.sheet_to_text(sheet);
                }).join('\n\n');
                logger.info(`Parsed Excel: ${sheetNames.length} sheets.`);
            } catch (xlsxError) {
                logger.error(`Excel Parsing Failed: ${xlsxError.message}`);
                textContent = "Excel parsing failed.";
            }
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
            try {
                const data = await officeParser.parse(fileBuffer);
                // officeparser returns text directly in modern versions or requires specific handling.
                // Assuming it returns string or object with string.
                textContent = typeof data === 'string' ? data : JSON.stringify(data);
                logger.info(`Parsed PPTX. Length: ${textContent.length}`);
            } catch (pptError) {
                logger.error(`PPTX Parsing Failed: ${pptError.message}`);
                textContent = "PPTX parsing failed.";
            }
        } else if (mimeType.startsWith('image/')) {
            try {
                logger.info(`Starting OCR for Image...`);
                const { data: { text } } = await Tesseract.recognize(fileBuffer, 'eng');
                textContent = text;
                logger.info(`OCR Complete. Extracted ${textContent.length} chars.`);
            } catch (ocrError) {
                logger.error(`OCR Failed: ${ocrError.message}`);
                textContent = "Image text extraction failed.";
            }
        } else if (mimeType === 'text/plain') {
            textContent = fileBuffer.toString('utf8');
        } else {
            logger.info('File type verification: Non-text file (Image/Video/Other). Skipping text extraction.');
        }

        // 2. Upload to Cloudinary
        try {
            logger.info("Uploading to Cloudinary...");
            cloudinaryResult = await uploadToCloudinary(fileBuffer, {
                resource_type: 'auto',
                public_id: originalName.split('.')[0] + '-' + Date.now()
            });
            logger.info(`Cloudinary Upload Success: ${cloudinaryResult.secure_url}`);
        } catch (cloudError) {
            logger.error(`Cloudinary Upload Failed: ${cloudError.message}`);
            return res.status(500).json({ success: false, message: 'Cloud storage failed' });
        }

        // 3. Store in Node.js AI Service (Only if text content available)
        if (textContent) {
            // Store in Atlas Vector Search
            const success = await aiService.storeDocument(textContent);
            if (success) {
                logger.info("Document text stored in Atlas Vector Store");
            } else {
                logger.warn("Document text storage returned false (maybe empty content or error).");
            }
        }

        // 4. Always Store Metadata
        try {
            await Knowledge.create({
                filename: originalName,
                cloudinaryUrl: cloudinaryResult.secure_url,
                cloudinaryId: cloudinaryResult.public_id,
                mimetype: mimeType,
                size: fileSize
            });
            logger.info(`Document metadata saved to MongoDB. RAG Enabled: ${!!textContent}`);
        } catch (dbError) {
            logger.error(`MongoDB Save Error: ${dbError.message}`);
        }

        res.status(200).json({
            success: true,
            message: 'File uploaded and processed successfully',
            data: {
                filename: originalName,
                url: cloudinaryResult.secure_url,
                mimetype: mimeType,
                size: fileSize,
                parsedTextLength: textContent.length,
                ragProcessed: !!textContent && textContent.length > 0
            }
        });

    } catch (error) {
        logger.error(`Upload Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Server error during upload' });
    }
};

// @desc    Get all uploaded documents
// @route   GET /api/knowledge/documents
// @access  Public
export const getDocuments = async (req, res) => {
    try {
        const documents = await Knowledge.find({}, 'filename uploadDate');
        res.status(200).json({
            success: true,
            data: documents
        });
    } catch (error) {
        logger.error(`Get Documents Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Server error fetching documents' });
    }
};

// @desc    Delete a document
// @route   DELETE /api/knowledge/:id
// @access  Public
export const deleteDocument = async (req, res) => {
    try {
        const document = await Knowledge.findById(req.params.id);
        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        await Knowledge.findByIdAndDelete(req.params.id);

        // Reload Vector Store to remove the document context
        await aiService.reloadVectorStore();

        res.status(200).json({
            success: true,
            message: 'Document deleted and knowledge base updated'
        });
    } catch (error) {
        logger.error(`Delete Document Error: ${error.message}`);
        res.status(500).json({ success: false, message: 'Server error deleting document' });
    }
};
