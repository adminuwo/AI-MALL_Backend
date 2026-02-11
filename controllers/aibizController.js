import AIBIZHistory from "../models/AIBIZHistory.js";
import { vertexAI } from "../config/vertex.js";
import mongoose from "mongoose";

// Using gemini-1.5-flash as it is the standard model configured in this project
// equivalent to gemini-2.5-flash from the original AIBIZ code if it was a typo or alias
const bizModel = vertexAI.getGenerativeModel({
    model: "gemini-2.5-flash",
});

/* ------------------ Generate + Save ------------------ */
export const generateDocument = async (req, res) => {
    try {
        const {
            businessName = "",
            idea = "",
            industry = "",
            targetAudience = "",
            tone = "formal",
            docType = "business_plan",
            extraNotes = "",
        } = req.body;

        if (!businessName && !idea) {
            return res.status(400).json({
                success: false,
                error: "businessName or idea is required",
            });
        }

        /* -------- Document Sections -------- */
        let docLabel = "BUSINESS PLAN";
        let sections = `
- Executive Summary
- Problem & Solution
- Market Overview
- Target Customer
- Business Model
- Go-To-Market Strategy
- Operations
- Revenue Streams
- KPIs & Metrics
- Roadmap
`;

        if (docType === "pitch_deck") {
            docLabel = "PITCH DECK";
            sections = `
- Vision
- Problem
- Solution
- Market Size
- Business Model
- Traction
- Go-To-Market
- Competition
- Team
- Ask
`;
        } else if (docType === "strategy") {
            docLabel = "STRATEGY DOCUMENT";
            sections = `
- Current Situation
- Vision
- Strategic Pillars
- Marketing
- Sales
- Execution
- KPIs
- Risks
`;
        }

        /* -------- Prompt -------- */
        const prompt = `
You are AIBIZ, a senior startup & business strategy consultant.

Create a detailed ${docLabel}.

Business Name: ${businessName}
Idea: ${idea}
Industry: ${industry}
Target Audience: ${targetAudience}
Tone: ${tone}
Extra Notes: ${extraNotes}

Follow this structure:
${sections}
`;

        const result = await bizModel.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const text =
            result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            return res.status(500).json({
                success: false,
                error: "No content generated",
            });
        }

        /* -------- SAVE TO MONGODB -------- */
        const saved = await AIBIZHistory.create({
            businessName,
            idea,
            industry,
            targetAudience,
            tone,
            docType,
            content: text,
            userId: req.user ? req.user.id : null // Store userId if authenticated
        });

        console.log(`✅ Document saved: ${saved._id}`);

        res.json({
            success: true,
            data: {
                document: text,
                id: saved._id,
            },
        });
    } catch (err) {
        console.error("❌ AIBIZ error:", err);
        res.status(500).json({
            success: false,
            error: "Failed to generate document",
        });
    }
};

/* ------------------ FETCH HISTORY ------------------ */
export const getHistory = async (req, res) => {
    try {
        // If authenticated, we could filter by user. For now returning all or per user preference.
        // Adapting AIBIZ original behavior (all history) but respecting user isolation if possible.
        // For now, let's keep it simple and return all like original, or filter if userId is present?
        // The original AIBIZ didn't have auth. The AI-MALL has auth.
        // To be safe and consistent with "AI-Mall", we should probably only show the user's history?
        // But the requirements said "add AIBIZ agent... updated version".
        // Let's filter by userId if req.user exists, otherwise return empty or all?
        // Given usage of verifyToken in routes, we will have req.user.

        const query = req.user ? { userId: req.user.id } : {};
        // Fallback: If no userId usage intended yet, maybe comment out. 
        // But AIBIZ original didn't have auth. 
        // I will use `req.user ? { userId: req.user.id } : {}` to support both modes, 
        // but since I added userId to model, old docs won't show up. 
        // Actually, to make it work seamlessly with the "Integration" context, and since the user probably wants to see *their* generated content:

        // NOTE: If I enforce userId filter, the user won't see anything initially. That's fine.

        const history = await AIBIZHistory.find(query).sort({ createdAt: -1 });
        console.log(`📋 Fetched ${history.length} documents from history`);
        res.json(history);
    } catch (err) {
        console.error("❌ Error fetching history:", err);
        res.status(500).json({ error: "Failed to fetch history" });
    }
};

/* ------------------ DELETE HISTORY ------------------ */
export const deleteHistory = async (req, res) => {
    try {
        const { id } = req.params;

        console.log("🗑️  DELETE request received for ID:", id);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                error: "Invalid document ID format"
            });
        }

        // Ensure user owns the document if authenticated
        const query = { _id: id };
        if (req.user) {
            query.userId = req.user.id;
        }

        const deletedDoc = await AIBIZHistory.findOneAndDelete(query);

        if (!deletedDoc) {
            return res.status(404).json({
                success: false,
                error: "Document not found or access denied"
            });
        }

        console.log("✅ Document deleted successfully:", id);

        res.status(200).json({
            success: true,
            message: "Document deleted successfully",
            deletedId: id
        });

    } catch (err) {
        console.error("❌ Delete error:", err);
        res.status(500).json({
            success: false,
            error: "Failed to delete document",
            details: err.message
        });
    }
};
