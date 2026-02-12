import axios from 'axios';

const testChat = async () => {
    try {
        console.log("Testing Main Chat (AIVA)...");
        const response = await axios.post('http://localhost:5000/api/chat', {
            content: "Hello, are you working?",
            history: [],
            systemInstruction: "You are a test bot."
        });
        console.log("Response:", response.data);
    } catch (error) {
        console.error("Chat Error Status:", error.response?.status);
        console.error("Chat Error Data:", error.response?.data);
    }
};

testChat();
