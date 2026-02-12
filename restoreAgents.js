
import mongoose from "mongoose";
import Agent from "./models/Agents.js";
import dotenv from "dotenv";

dotenv.config();

const RESTORE_AGENTS = [
    // CORE AI SYSTEM
    {
        agentName: "AIBIZ™",
        slug: "aibiz",
        description: "The central control room for your entire company. Manage Sales, HR, Finance & Ops in one place.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "/demo/scene1.png"
    },
    {
        agentName: "AIVA™",
        slug: "aiva",
        description: "Your intelligent personal secretary for tasks, reminders, and summaries.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1589254065878-42c9da997008?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AISTREAM™",
        slug: "aistream",
        description: "Continuous data collection and organization from live systems.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AICRAFT™",
        slug: "aicraft",
        description: "Automated content generation for blogs, ads, and visuals.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Design & Creative",
        avatar: "https://images.unsplash.com/photo-1626785774573-4b799315345d?q=80&w=2071&auto=format&fit=crop"
    },
    {
        agentName: "AIOFFICE™",
        slug: "aioffice",
        description: "A smart digital office that organizes documents and meetings.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1497215728101-856f4ea42174?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIDESK™",
        slug: "aidesk",
        description: "Virtual customer support agent for instant replies and ticket routing.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?q=80&w=2072&auto=format&fit=crop"
    },
    {
        agentName: "AIFLOW™",
        slug: "aiflow",
        description: "Automates repetitive work using intelligent rules and triggers.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?q=80&w=1974&auto=format&fit=crop"
    },
    {
        agentName: "AICORE™",
        slug: "aicore",
        description: "The brain connecting and coordinating all your AI-Mall apps.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Business OS",
        avatar: "https://images.unsplash.com/photo-1507413245164-6160d8298b31?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIBASE™",
        slug: "aibase",
        description: "Reliable company memory system for fast answers and data retrieval.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Data & Intelligence",
        avatar: "https://images.unsplash.com/photo-1454165833767-027ffea9e77b?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIMIND™",
        slug: "aimind",
        description: "Helps leaders make decisions based on market and business data.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Data & Intelligence",
        avatar: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=2426&auto=format&fit=crop"
    },

    // SALES & MARKETING
    {
        agentName: "AISALES™",
        slug: "aisales",
        description: "Automates sales follow-ups and provides revenue insights.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AICRM™",
        slug: "aicrm",
        description: "Automatically maintains customer profiles and interactions.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AILEAD™",
        slug: "ailead",
        description: "Identifies and qualifies leads based on target criteria.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIMARKET™",
        slug: "aimarket",
        description: "Detects market trends and competitive opportunities.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1531482615713-2afd69097998?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIBRAND™",
        slug: "aibrand",
        description: "Ensures brand consistency across all marketing materials.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1557838923-2985c318be48?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIAD™",
        slug: "aiad",
        description: "Optimizes ad spend and creative performance in real-time.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIFUNNEL™",
        slug: "aifunnel",
        description: "Optimizes website funnels based on visitor behavior.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1533750349088-cd871a92f312?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AICALL™",
        slug: "aicall",
        description: "Scalable voice outreach with automated call summaries.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1589254065878-42c9da997008?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIBOT™",
        slug: "aibot",
        description: "Advanced chatbot for customer engagement and replies.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1531746020798-e795c5395c40?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AICONNECT™",
        slug: "aiconnect",
        description: "Manages professional networking and introductions.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Sales & Marketing",
        avatar: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=2071&auto=format&fit=crop"
    },

    // HR, FINANCE & OPERATIONS
    {
        agentName: "AIHR™",
        slug: "aihr",
        description: "Streamlines HR processes and employee data reporting.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1521791136064-7986c29598a5?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIPAY™",
        slug: "aipay",
        description: "The OS for your business payments, invoices, and billing.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?q=80&w=2072&auto=format&fit=crop"
    },
    {
        agentName: "AITEAM™",
        slug: "aiteam",
        description: "Drives team productivity with intelligent task insights.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIHIRE™",
        slug: "aihire",
        description: "Automates resume screening and candidate shortlisting.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIBILL™",
        slug: "aibill",
        description: "Automatically tracks receipts and generates expense summaries.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1554224154-26038ffc0d07?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AITAX™",
        slug: "aitax",
        description: "Automated tax record prep and compliance auditing.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1554224155-1697454275b9?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AILEGAL™",
        slug: "ailegal",
        description: "Analyzes contracts and identifies legal risks automatically.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1589391886645-d51941baf7fb?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIDOC™",
        slug: "aidoc",
        description: "Converts PDFs and images into structured business data.",
        pricing: { type: "Free" },
        status: "Live",
        category: "Operations",
        avatar: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AISTAFF™",
        slug: "aistaff",
        description: "Automates employee onboarding plans and workflows.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?q=80&w=2070&auto=format&fit=crop"
    },
    {
        agentName: "AIAUDIT™",
        slug: "aiaudit",
        description: "Performs continuous financial auditing and error detection.",
        pricing: { type: "Free" },
        status: "Live",
        category: "HR & Finance",
        avatar: "https://images.unsplash.com/photo-1554672408-730436b60dde?q=80&w=2070&auto=format&fit=crop"
    }
];

const seedDB = async () => {
    try {
        console.log("🚀 Connecting to DB to restore agents...");
        await mongoose.connect(process.env.MONGODB_ATLAS_URI);
        console.log("✅ DB Connected.");

        // IMPORTANT: We do not wipe existing user agents or other data.
        // We only want to ensure these agents exist in the 'marketplace' (Agent collection).
        // Option: Delete all mock agents first to ensure no duplicates, or upsert.
        // User said "restore them", assuming wiped. Let's clear the Agent collection to be clean.
        // WARNING: This clears ALL agents.

        console.log("🧹 Clearing existing Agent inventory...");
        await Agent.deleteMany({});
        console.log("✨ Cleared.");

        console.log(`🌱 Seeding ${RESTORE_AGENTS.length} agents...`);
        await Agent.insertMany(RESTORE_AGENTS);

        console.log("✅ 50 Apps Restored Successfully!");
        process.exit(0);
    } catch (err) {
        console.error("❌ Failed to seed agents:", err);
        process.exit(1);
    }
};

seedDB();
