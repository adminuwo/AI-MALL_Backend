import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import officeParser from 'officeparser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the service account key file
const keyFilename = path.join(__dirname, '../google_cloud_credentials.json');

// Initialize the client if key exists
// Initialize the client
let client = null;

try {
    if (fs.existsSync(keyFilename)) {
        client = new textToSpeech.TextToSpeechClient({ keyFilename });
        console.log("✅ [VoiceController] Google Cloud TTS Client Initialized with Key File");
    } else {
        console.warn("⚠️ [VoiceController] Key file not found, attempting ADC...");
        // Fallback to ADC
        client = new textToSpeech.TextToSpeechClient();
        console.log("✅ [VoiceController] Google Cloud TTS Client Initialized with ADC");
    }
} catch (err) {
    console.warn("⚠️ [VoiceController] Failed to initialize TTS Client:", err.message);
    try {
        // Last ditch effort: Try ADC if key file init failed
        client = new textToSpeech.TextToSpeechClient();
        console.log("✅ [VoiceController] Google Cloud TTS Client Initialized with ADC (Fallback)");
    } catch (finalErr) {
        console.error("❌ [VoiceController] Critical: TTS Client Init Failed:", finalErr.message);
    }
}

export const synthesizeSpeech = async (req, res) => {
    if (!client) {
        return res.status(403).json({
            error: 'Google Cloud TTS not configured',
            details: 'Service account key missing on server.'
        });
    }
    try {
        const { text, languageCode = 'en-US', gender = 'FEMALE', tone } = req.body;

        if (!text) {
            console.error("❌ [VoiceController] No text provided!");
            return res.status(400).json({ error: 'Text is required' });
        }

        // Pre-processing for natural pronunciation
        let processedText = text
            .replace(/[,.-]/g, " ")
            .replace(/\btm\b/gi, "tum")
            .replace(/\bkkrh\b/gi, "kya kar rahe ho")
            .replace(/\bclg\b/gi, "college")
            .replace(/\bplz\b/gi, "please")
            .replace(/\s+/g, " ")
            .trim();


        // Preferred voices map structure: [Language][Gender]
        const voiceMap = {
            'hi-IN': {
                'FEMALE': 'hi-IN-Neural2-A',
                'MALE': 'hi-IN-Neural2-B'
            },
            'en-US': {
                'FEMALE': 'en-US-Journey-F',
                'MALE': 'en-US-Journey-D'
            },
            'en-IN': {
                'FEMALE': 'en-IN-Neural2-A',
                'MALE': 'en-IN-Neural2-B'
            }
        };

        // Fallback logic
        let voiceName = `${languageCode}-Neural2-A`;
        if (voiceMap[languageCode] && voiceMap[languageCode][gender]) {
            voiceName = voiceMap[languageCode][gender];
        } else {
            const suffix = gender === 'MALE' ? 'B' : 'A';
            voiceName = `${languageCode}-Neural2-${suffix === 'B' ? 'D' : 'A'}`;
        }

        // Determine tone
        const isNarrative = tone === 'narrative' || (tone !== 'conversational' && text.length > 500);

        const audioConfig = {
            audioEncoding: 'MP3',
            speakingRate: isNarrative ? 0.95 : 1.0,
            pitch: 0.0,
            volumeGainDb: 1.0
        };
        const request = {
            input: { text: processedText },
            voice: {
                languageCode: languageCode,
                name: voiceName,
                ssmlGender: gender
            },
            audioConfig: audioConfig,
        };


        // Perform the text-to-speech request
        console.log("📤 [VoiceController] Calling Google TTS API...");
        const [response] = await client.synthesizeSpeech(request);

        let audioData = response.audioContent;
        if (!Buffer.isBuffer(audioData)) {

            audioData = Buffer.from(audioData, 'base64');
        }

        console.log("✅ [VoiceController] TTS successful, audio size:", audioData.length);

        // Return the audio content
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioData.length,
        });

        res.send(audioData);

    } catch (error) {
        console.error('❌ [VoiceController] ERROR:', error);
        console.error('❌ [VoiceController] Error details:', {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack
        });
        res.status(500).json({ error: 'Failed to synthesize speech', details: error.message });
    }
};

export const synthesizeFile = async (req, res) => {
    console.log("📢 [VoiceController] File Synthesis Request Received!");
    if (!client) {
        return res.status(403).json({
            error: 'Google Cloud TTS not configured',
            details: 'Service account key missing on server.'
        });
    }

    try {
        const { fileData, mimeType, languageCode: reqLangCode = 'en-US', gender = 'FEMALE', introText } = req.body;

        if ((!fileData || !mimeType) && !introText) {
            console.error("❌ [VoiceController] Missing required fields");
            return res.status(400).json({ error: 'Either fileData or introText is required' });
        }

        let textToRead = "";

        if (fileData) {
            const buffer = Buffer.from(fileData, 'base64');
            console.log(`📦 [VoiceController] Processing ${buffer.length} bytes, MIME: ${mimeType}`);

            try {
                if (mimeType === 'application/pdf') {
                    const data = await pdfParse(buffer);
                    textToRead = data.text;
                } else if (mimeType.includes('word') || mimeType.includes('officedocument') || mimeType.endsWith('.docx') || mimeType.endsWith('.doc')) {
                    try {
                        textToRead = await officeParser.parseOfficeAsync(buffer);
                    } catch (e) {
                        const result = await mammoth.extractRawText({ buffer });
                        textToRead = result.value;
                    }
                } else if (mimeType.startsWith('image/')) {
                    const { data: { text } } = await Tesseract.recognize(buffer, 'eng+hin');
                    textToRead = text;
                } else if (mimeType.startsWith('text/')) {
                    textToRead = buffer.toString('utf-8');
                } else {
                    console.warn(`⚠️ [VoiceController] Unsupported MIME type: ${mimeType}`);
                }
            } catch (extractionError) {
                console.error("❌ [VoiceController] Text extraction failed:", extractionError);
                return res.status(500).json({ error: 'Text extraction failed', details: extractionError.message });
            }
        }

        if (introText && introText.trim().length > 0) {
            textToRead = `${introText}\n\n${textToRead}`;
        }

        // Sanitize text
        textToRead = textToRead
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
            .replace(/™/g, " tm ")
            .replace(/©/g, " ")
            .replace(/[,\.?;"\\*\/+\-:@\[\]\(\)\|_]/g, " ")
            .replace(/\btm\b/gi, "tum")
            .replace(/\s+/g, " ")
            .trim();

        if (!textToRead || textToRead.length < 2) {
            return res.status(400).json({ error: 'Could not extract enough readable text from this file.' });
        }

        // Auto-detect Language
        const hindiCharCount = (textToRead.match(/[\u0900-\u097F]/g) || []).length;
        const totalCharCount = textToRead.length;
        const isHindi = (hindiCharCount / totalCharCount) > 0.05 || hindiCharCount > 15;

        // Chunking for long documents
        const CHUNK_SIZE = isHindi ? 1400 : 4000;
        const textChunks = [];

        for (let i = 0; i < textToRead.length; i += CHUNK_SIZE) {
            textChunks.push(textToRead.substring(i, i + CHUNK_SIZE));
        }

        let finalLanguageCode = isHindi ? 'hi-IN' : 'en-US';
        let finalVoiceName = isHindi ? 'hi-IN-Neural2-D' : (gender === 'MALE' ? 'en-US-Neural2-D' : 'en-US-Neural2-F');

        console.log(`📖 [VoiceController] Synthesis - Lang: ${finalLanguageCode}, Chars: ${textToRead.length}, Chunks: ${textChunks.length}`);

        const audioBuffers = [];
        const BATCH_SIZE = 15;

        for (let i = 0; i < textChunks.length; i += BATCH_SIZE) {
            const batch = textChunks.slice(i, i + BATCH_SIZE);
            console.log(`📦 [VoiceController] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(textChunks.length / BATCH_SIZE)}...`);

            const batchPromises = batch.map((chunk, index) => {
                const request = {
                    input: { text: chunk },
                    voice: { languageCode: finalLanguageCode, name: finalVoiceName, ssmlGender: gender },
                    audioConfig: {
                        audioEncoding: 'MP3',
                        speakingRate: 0.95,
                        pitch: 0.0,
                        volumeGainDb: 2.0
                    },
                };
                return client.synthesizeSpeech(request)
                    .then(([response]) => {
                        let chunkData = response.audioContent;
                        if (!Buffer.isBuffer(chunkData)) {
                            chunkData = Buffer.from(chunkData, 'base64');
                        }
                        return chunkData;
                    })
                    .catch(err => {
                        console.error(`❌ [VoiceController] Chunk ${i + index} failed:`, err.message);
                        throw err;
                    });
            });

            const batchResults = await Promise.all(batchPromises);
            audioBuffers.push(...batchResults);
        }


        const audioData = Buffer.concat(audioBuffers);
        console.log(`✅ [VoiceController] Synthesis Complete. Total Audio Size: ${audioData.length} bytes`);

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioData.length,
            'X-Text-Length': textToRead.length.toString(),
            'X-Chunk-Count': textChunks.length.toString(),
            'Access-Control-Expose-Headers': 'X-Text-Length, X-Chunk-Count'
        });
        res.send(audioData);

    } catch (error) {
        console.error('❌ [VoiceController] Critical Synthesis Failure:', error);
        res.status(500).json({
            error: 'Voice conversion failed',
            details: error.message,
            code: error.code
        });
    }
};
