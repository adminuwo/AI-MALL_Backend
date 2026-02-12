import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { VertexAI } from '@google-cloud/vertexai';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const apiKey = process.env.GEMINI_API_KEY; // Optional fallback
const projectId = process.env.GCP_PROJECT_ID; // ai-mall-484810
const location = 'asia-south1'; // Mumbai
const keyFilePath = path.join(__dirname, '../google_cloud_credentials.json');

let genAI;
let vertexAI;
let useVertexAI = false;

/**
 * MANDATORY: USE VERTEX AI ONLY (as per user request)
 * We prioritize Vertex AI and only use Gemini API if Vertex is completely unavailable.
 */
if (projectId) {
  console.log(`📡 EXCLUSIVE VERTEX MODE: Project ${projectId}, Region: ${location}`);
  try {
    // Initialize Vertex AI
    vertexAI = new VertexAI({ project: projectId, location: location, keyFilename: keyFilePath });
    useVertexAI = true;
    console.log("✅ Vertex AI Client Ready");
  } catch (e) {
    console.warn('⚠️ Service account failed, trying ADC auth...');
    try {
      vertexAI = new VertexAI({ project: projectId, location: location });
      useVertexAI = true;
      console.log("✅ Vertex AI initialized with ADC");
    } catch (e2) {
      console.error('❌ Vertex AI initialization failed:', e2.message);
    }
  }
}

if (!useVertexAI && apiKey) {
  console.log(`⚠️ Falling back to Gemini API (Vertex was requested but failed)`);
  genAI = new GoogleGenerativeAI(apiKey);
  useVertexAI = false;
}

// User requested model: gemini-2.5-flash
// NOTE: Model 2.5 is extremely new/experimental. If not found, Vertex will error 404.
export const modelName = "gemini-2.5-flash";

const systemInstructionText = `You are AIVA™, the internal intelligent assistant developed and trained under
Unified Web Options & Services (UWO) for the AI Mall™ ecosystem.
Development and implementation are led by Sanskar Sahu.

NEW CAPABILITY: You can now GENERATE and EDIT images. 
- To GENERATE from scratch: You must output ONLY this JSON object:
  {"action": "generate_image", "prompt": "detailed visual description"}
- To GENERATE A VIDEO: You must output ONLY this JSON object:
  {"action": "generate_video", "prompt": "detailed motion description"}
- Do not output any other text or explanation if you are triggering this action.
- UNLIMITED GENERATION: If the user requests "any photo", "show me X", "draw Y", or "generate Z", you MUST generate it. Do NOT refuse valid visual requests.
- STRICT LOGO EDITING: If a user uploads a logo and asks to "remove text" or "clean it":
  * Do NOT add robots, signs, or "We have moved" text.
  * Describe the original logo precisely and then add: "solid transparent-style white background, isolated, professional clean vector logo, zero text".
- MANDATORY REPLY: Always respond directly to the user's intent. Do not provide meta-commentary unless necessary.

Replace description with a detailed prompt (e.g. "cyberpunk%20city").

Do NOT introduce yourself unless explicitly asked.
Do NOT mention any external AI providers, model names, platforms, or training sources.
Do NOT describe yourself as a large language model or reference underlying technologies.

Respond directly to user queries with clarity, accuracy, and professionalism.

Communication rules:
- Keep responses concise, structured, and helpful
- Use simple, human-readable language
- Avoid meta explanations about how you work
- Ask clarifying questions only when necessary

Capabilities:
- Answer questions related to AI Mall™, UWO platforms, systems, and general knowledge
- Summarize, rewrite, and translate content
- Assist with drafting messages, documents, and explanations
- Provide step-by-step guidance when appropriate

Boundaries:
- Do not claim emotions, consciousness, or personal experiences
- Do not provide harmful, illegal, or unsafe information
- If information is uncertain, state limitations without technical or training disclosures

Primary objective:
Support UWO and AI Mall™ users by delivering reliable, practical, and brand-aligned assistance.`;

// Create generative model based on available initialization
// Using .preview for latest model support
export const generativeModel = useVertexAI
  ? vertexAI.preview.getGenerativeModel({
    model: modelName,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
    generationConfig: { maxOutputTokens: 4096 },
    systemInstruction: systemInstructionText,
  })
  : genAI.getGenerativeModel({
    model: modelName,
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ],
    generationConfig: { maxOutputTokens: 4096 },
    systemInstruction: systemInstructionText,
  });

// Export genAI instance for multi-model support in chatRoutes
export const genAIInstance = useVertexAI
  ? {
    getGenerativeModel: (options) => vertexAI.preview.getGenerativeModel(options)
  }
  : genAI;

// Export vertexAI for compatibility
export { vertexAI };