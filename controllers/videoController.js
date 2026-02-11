import axios from 'axios';
import logger from '../utils/logger.js';
import { GoogleAuth } from 'google-auth-library';
import { uploadToCloudinary } from '../services/cloudinary.service.js';

// Video generation using external APIs (e.g., Replicate, Runway, or similar)
export const generateVideo = async (req, res) => {
  try {
    const { prompt, duration = 5, quality = 'medium' } = req.body;
    const userId = req.user?.id;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required and must be a string'
      });
    }

    logger.info(`[VIDEO] Generating video with prompt: ${prompt.substring(0, 100)}`);

    // Example using Replicate API for video generation
    // You can replace this with your preferred video generation service
    const videoUrl = await generateVideoFromPrompt(prompt, duration, quality);

    if (!videoUrl) {
      throw new Error('Failed to generate video');
    }

    logger.info(`[VIDEO] Video generated successfully: ${videoUrl}`);

    return res.status(200).json({
      success: true,
      videoUrl: videoUrl,
      prompt: prompt,
      duration: duration,
      quality: quality
    });

  } catch (error) {
    logger.error(`[VIDEO ERROR] ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate video'
    });
  }
};

// Function to generate video using Replicate or Fallback
// Function to generate video using Vertex AI (Veo Model) or Fallback
export const generateVideoFromPrompt = async (prompt, duration, quality) => {
  try {
    logger.info('[VIDEO] Attempting generation via Vertex AI Veo (veo-001-preview)...');

    const auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
      projectId: process.env.GCP_PROJECT_ID || process.env.PROJECT_ID
    });
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    const accessTokenResponse = await client.getAccessToken();
    const token = accessTokenResponse.token || accessTokenResponse;

    // Use Veo model
    const modelId = 'veo-001-preview';
    const location = 'us-central1'; // Veo is available in us-central1
    const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    const response = await axios.post(
      endpoint,
      {
        instances: [{ prompt: prompt }],
        parameters: {
          video_length_seconds: duration || 5, // Veo param might use underscores
          sampleCount: 1,
          aspectRatio: "16:9"
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data && response.data.predictions && response.data.predictions[0]) {
      const prediction = response.data.predictions[0];

      // Veo often returns a 'video' object containing 'bytesBase64Encoded' OR 'gcsUri'
      // We check for base64 first
      let base64Data = prediction.bytesBase64Encoded || prediction.video?.bytesBase64Encoded;

      // As valid fallback for older models or variations
      if (!base64Data && typeof prediction === 'string') {
        base64Data = prediction;
      }

      // If we only get a GCS URI (Cloud Storage), we can't upload to Cloudinary directly from here easily without downloading
      // BUT, checking logs, Veo usually supports base64 for short clips.

      if (base64Data) {
        const buffer = Buffer.from(base64Data, 'base64');
        // Upload to Cloudinary
        const uploadResult = await uploadToCloudinary(buffer, {
          resource_type: 'video',
          folder: 'aisa_generated_videos'
        });
        logger.info(`[VERTEX VEO] Uploaded to Cloudinary: ${uploadResult.secure_url}`);
        return uploadResult.secure_url;
      } else {
        logger.warn("[VERTEX VEO] No base64 data found. Full prediction keys:", Object.keys(prediction));
      }
    }

    throw new Error('Vertex AI Veo did not return a valid video payload.');

  } catch (error) {
    logger.error(`[VERTEX VIDEO ERROR] ${error.message} - Helper fallback normally would trigger here.`);
    throw error;
  }
};

// Poll Replicate for video generation result
const pollReplicateResult = async (predictionId, apiKey, maxAttempts = 60) => {
  try {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            'Authorization': `Token ${apiKey}`
          }
        }
      );

      if (response.data.status === 'succeeded') {
        return response.data.output?.[0] || null;
      } else if (response.data.status === 'failed') {
        throw new Error('Video generation failed on server');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Video generation timeout');
  } catch (error) {
    logger.error(`[POLL ERROR] ${error.message}`);
    throw error;
  }
};

// Alternative: Generate video using Pollinations API (free)
export const generateVideoWithPollinations = async (prompt, duration, quality) => {
  try {
    // Pollinations offers free video generation via API
    // Pollinations offers free generation via API
    // Note: Video generation endpoint is deprecated/moved. Using high-quality image as preview.
    // Using the /p/ endpoint which is more reliable for the new version
    const videoUrl = `https://pollinations.ai/p/${encodeURIComponent(prompt)}`;

    logger.info(`[POLLINATIONS VIDEO] Generated: ${videoUrl}`);
    return videoUrl;
  } catch (error) {
    logger.error(`[POLLINATIONS ERROR] ${error.message}`);
    return null;
  }
};

// Get video generation status
export const getVideoStatus = async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!videoId) {
      return res.status(400).json({
        success: false,
        message: 'Video ID is required'
      });
    }

    // You would implement status tracking based on your video service
    // This is a placeholder implementation

    return res.status(200).json({
      success: true,
      status: 'completed',
      videoId: videoId
    });

  } catch (error) {
    logger.error(`[VIDEO STATUS ERROR] ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get video status'
    });
  }
};
