import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * File Conversion Service for AISA
 * Handles PDF ↔ DOCX conversions
 */

/**
 * Detect file type from buffer
 * @param {Buffer} buffer - File buffer
 * @returns {string} - File type: 'pdf', 'docx', or 'unknown'
 */
function detectFileType(buffer) {
    // PDF files start with %PDF
    if (buffer.toString('utf8', 0, 4) === '%PDF') {
        return 'pdf';
    }

    // DOCX files are ZIP archives with specific structure
    // Check for PK (ZIP signature) at start
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
        return 'docx';
    }

    return 'unknown';
}

/**
 * Validate if conversion is supported
 * @param {string} sourceType - Source file type
 * @param {string} targetType - Target file type
 * @returns {boolean} - True if conversion is supported
 */
function validateConversionRequest(sourceType, targetType) {
    const validConversions = [
        { from: 'pdf', to: 'docx' },
        { from: 'docx', to: 'pdf' },
        { from: 'doc', to: 'pdf' }
    ];

    return validConversions.some(
        conv => conv.from === sourceType.toLowerCase() && conv.to === targetType.toLowerCase()
    );
}

/**
 * Convert PDF to DOCX
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Buffer>} - DOCX file buffer
 */
async function convertPdfToDocx(pdfBuffer) {
    try {
        // Parse PDF to extract text
        const pdfData = await pdfParse(pdfBuffer);
        const text = pdfData.text;

        // Split text into paragraphs
        const paragraphs = text.split('\n').filter(line => line.trim().length > 0);

        // Create DOCX document
        const doc = new Document({
            sections: [{
                properties: {},
                children: paragraphs.map(para =>
                    new Paragraph({
                        children: [new TextRun(para)]
                    })
                )
            }]
        });

        // Generate buffer
        const buffer = await Packer.toBuffer(doc);
        return buffer;

    } catch (error) {
        console.error('PDF to DOCX conversion error:', error);
        throw new Error('Failed to convert PDF to DOCX: ' + error.message);
    }
}

/**
 * Helper to wrap text based on width
 */
function wrapText(text, width, font, fontSize) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > width && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * Convert DOCX to PDF
 * @param {Buffer} docxBuffer - DOCX file buffer
 * @returns {Promise<Buffer>} - PDF file buffer
 */
async function convertDocxToPdf(docxBuffer) {
    try {
        // Extract text from DOCX
        const result = await mammoth.extractRawText({ buffer: docxBuffer });
        let text = result.value;

        // Clean text: remove or replace problematic Unicode characters
        // Keep only ASCII-safe characters and common Unicode ranges
        text = text.replace(/[^\x00-\x7F\u0080-\u00FF\u0100-\u017F\u0180-\u024F]/g, '?');

        // Create PDF document
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const pageWidth = 595.28; // A4 width in points
        const pageHeight = 841.89; // A4 height in points
        const margin = 50;
        const fontSize = 11;
        const lineHeight = fontSize * 1.4;
        const maxWidth = pageWidth - (margin * 2);

        // Split text into paragraphs
        const paragraphs = text.split('\n');

        let page = pdfDoc.addPage([pageWidth, pageHeight]);
        let yPosition = pageHeight - margin;

        for (const para of paragraphs) {
            const cleanPara = para.trim();

            // Handle empty paragraphs as small gaps
            if (cleanPara.length === 0) {
                yPosition -= lineHeight * 0.5;
                if (yPosition < margin) {
                    page = pdfDoc.addPage([pageWidth, pageHeight]);
                    yPosition = pageHeight - margin;
                }
                continue;
            }

            // Wrap text for this paragraph
            const wrappedLines = wrapText(cleanPara, maxWidth, font, fontSize);

            for (const line of wrappedLines) {
                if (yPosition < margin) {
                    page = pdfDoc.addPage([pageWidth, pageHeight]);
                    yPosition = pageHeight - margin;
                }

                try {
                    page.drawText(line, {
                        x: margin,
                        y: yPosition,
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                } catch (drawError) {
                    // If drawing fails, try with sanitized text
                    const sanitized = line.replace(/[^\x00-\x7F]/g, '?');
                    page.drawText(sanitized, {
                        x: margin,
                        y: yPosition,
                        size: fontSize,
                        font: font,
                        color: rgb(0, 0, 0),
                    });
                }

                yPosition -= lineHeight;
            }
            // Extra gap between paragraphs
            yPosition -= lineHeight * 0.3;
        }

        // Save PDF
        const pdfBytes = await pdfDoc.save();
        return Buffer.from(pdfBytes);

    } catch (error) {
        console.error('DOCX to PDF conversion error:', error);
        throw new Error('Failed to convert DOCX to PDF: ' + error.message);
    }
}

/**
 * Main conversion function
 * @param {Buffer} fileBuffer - Source file buffer
 * @param {string} sourceFormat - Source format (pdf/docx)
 * @param {string} targetFormat - Target format (pdf/docx)
 * @returns {Promise<Buffer>} - Converted file buffer
 */
export async function convertFile(fileBuffer, sourceFormat, targetFormat) {
    // Validate conversion
    if (!validateConversionRequest(sourceFormat, targetFormat)) {
        throw new Error(`Conversion from ${sourceFormat} to ${targetFormat} is not supported`);
    }

    // Detect actual file type
    const detectedType = detectFileType(fileBuffer);
    if (detectedType === 'unknown') {
        throw new Error('Unable to detect file type. Please ensure the file is a valid PDF or DOCX');
    }

    // Perform conversion
    if (sourceFormat.toLowerCase() === 'pdf' && targetFormat.toLowerCase() === 'docx') {
        return await convertPdfToDocx(fileBuffer);
    } else if (sourceFormat.toLowerCase() === 'docx' && targetFormat.toLowerCase() === 'pdf') {
        return await convertDocxToPdf(fileBuffer);
    }

    throw new Error('Unsupported conversion type');
}

export { convertPdfToDocx, convertDocxToPdf, detectFileType, validateConversionRequest };
