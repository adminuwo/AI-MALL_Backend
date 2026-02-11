import { uploadToCloudinary } from '../services/cloudinary.service.js';
import axios from 'axios';
import logger from '../utils/logger.js';
import { GoogleAuth } from 'google-auth-library';

// Helper function to generate image using Vertex AI (Imagen 3)
export const generateImageFromPrompt = async (prompt) => {
    try {
        console.log(`[VERTEX IMAGE] Triggered for: "${prompt}"`);

        // Check if we have credentials to even attempt Vertex
        // If not, skip directly to fallback to save time and error logs
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCP_PROJECT_ID) {
            throw new Error("Missing GCP Credentials/Project ID - Skipping Vertex");
        }

        const auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
            projectId: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID
        });

        const client = await auth.getClient();
        const projectId = await auth.getProjectId();
        const accessTokenResponse = await client.getAccessToken();
        const token = accessTokenResponse.token || accessTokenResponse;

        const location = 'us-central1';
        // Try Imagen 3.0 Generate 002 or fallback to 001
        const modelId = 'imagen-3.0-generate-001';
        const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

        const response = await axios.post(
            endpoint,
            {
                instances: [{ prompt: prompt }],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: "1:1",
                    safetyFilterLevel: "block_low_and_above",
                    personGeneration: "allow_all"
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 25000 // 25s timeout
            }
        );

        if (response.data && response.data.predictions && response.data.predictions[0]) {
            const prediction = response.data.predictions[0];
            const base64Data = prediction.bytesBase64Encoded || prediction;

            if (base64Data && typeof base64Data === 'string') {
                const buffer = Buffer.from(base64Data, 'base64');
                const cloudResult = await uploadToCloudinary(buffer, {
                    folder: 'generated_images',
                    public_id: `gen_${Date.now()}`
                });
                logger.info(`[VERTEX IMAGE] Success: ${cloudResult.secure_url}`);
                return cloudResult.secure_url;
            }
        }

        throw new Error('Vertex AI did not return valid image data.');

    } catch (error) {
        const errorMsg = error.message || "Unknown error";
        console.warn(`[VERTEX IMAGE FALLBACK] Reason: ${errorMsg}. Switching to Pollinations.`);

        // Robust Fallback to Pollinations with Flux model
        // Flux is the best free model available on Pollinations currently
        const safePrompt = encodeURIComponent(prompt.substring(0, 500)); // Safety limit
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${safePrompt}?width=1024&height=1024&nologo=true&model=flux&seed=${Math.floor(Math.random() * 1000000)}`;

        // Optionally upload pollinations image to Cloudinary to make it permanent
        // This is important because Pollinations links can be slow or expire
        try {
            console.log(`[PROXY DOWNLOAD] Fetching from Pollinations: ${pollinationsUrl}`);
            const resp = await axios.get(pollinationsUrl, {
                responseType: 'arraybuffer',
                timeout: 15000
            });

            console.log(`[PROXY UPLOAD] Uploading to Cloudinary...`);
            const cloudResult = await uploadToCloudinary(Buffer.from(resp.data), {
                folder: 'generated_images',
                public_id: `poll_${Date.now()}`
            });
            console.log(`[PROXY SUCCESS] URL: ${cloudResult.secure_url}`);
            return cloudResult.secure_url;

        } catch (e) {
            console.error(`[PROXY FAILED] ${e.message}. Returning direct link.`);
            // Fallback to direct link if upload fails
            return pollinationsUrl;
        }
    }
};

// @desc    Generate Image
// @route   POST /api/image/generate
// @access  Public
export const generateImage = async (req, res, next) => {
    try {
        const { prompt } = req.body || {};

        if (!prompt) {
            return res.status(400).json({ success: false, message: 'Prompt is required' });
        }

        if (logger && logger.info) logger.info(`[Image Generation] Processing: "${prompt}"`);
        else console.log(`[Image Generation] Processing: "${prompt}"`);

        const imageUrl = await generateImageFromPrompt(prompt);

        if (!imageUrl) {
            throw new Error("Failed to retrieve image URL from any source.");
        }

        res.status(200).json({
            success: true,
            data: imageUrl
        });
    } catch (error) {
        if (logger && logger.error) logger.error(`[Image Generation] Critical Error: ${error.message}`);
        else console.error(`[Image Generation] Critical Error`, error);

        res.status(500).json({
            success: false,
            message: `Image generation failed: ${error.message}`
        });
    }
};

