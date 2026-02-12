
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.warn("GEMINI_API_KEY is missing in .env environment variables");
}

export const genAI = new GoogleGenerativeAI(apiKey);

// Config for the standard text model
// Using gemini-1.5-flash which is widely available and performant
const textModelName = 'gemini-flash-latest';

// Create a default instance similar to what was exported as 'generativeModel' in vertex config
export const generativeModel = genAI.getGenerativeModel({
    model: textModelName,
    safetySettings: [
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
        }
    ],
    generationConfig: {
        maxOutputTokens: 4192
    },
    systemInstruction: {
        role: 'system',
        parts: [{
            text: `You are AIVA™, the internal intelligent assistant developed and trained under
Unified Web Options & Services (UWO) for the AI Mall™ ecosystem.
Development and implementation are led by Sanskar Sahu.

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
Support UWO and AI Mall™ users by delivering reliable, practical, and brand-aligned assistance.`
        }]
    },
});

// For visual models if needed
export const generativeVisionModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
});

// Preview alias
export const generativeModelPreview = generativeModel;
