const { parentPort, workerData } = require('worker_threads');
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { GoogleVertexAIEmbeddings } = require("@langchain/community/embeddings/googlevertexai");

let embeddings = null;

// Initialize embeddings in the worker thread
const initializeEmbeddings = async () => {
    if (!embeddings) {
        // Use Vertex AI Embeddings (Cloud-based, no local binaries)
        // console.log("Worker: Initializing Embeddings Model...");
        embeddings = new GoogleVertexAIEmbeddings({
            model: "text-embedding-004", // Optimize for cost/performance
            maxOutputTokens: 2048,
            location: 'asia-south1',
        });
    }
};

parentPort.on('message', async (task) => {
    try {
        const { text, type } = task;

        if (type === 'process') {
            await initializeEmbeddings();

            if (!text || typeof text !== 'string') {
                throw new Error("Invalid text content for embedding: input must be a string");
            }

            // 1. Split Text
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 1000,
                chunkOverlap: 200,
            });
            const docs = await splitter.createDocuments([text]);

            // 2. Generate Embeddings as Numbers (Array)
            // .embedDocuments returns Promise<number[][]>
            const vectors = await embeddings.embedDocuments(docs.map(d => d.pageContent));

            // 3. Serialize for transport (ensure clean JSON objects)
            const result = docs.map((doc, i) => ({
                pageContent: doc.pageContent,
                metadata: doc.metadata,
                vector: vectors[i]
            }));

            parentPort.postMessage({ success: true, data: result });
        }
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});
