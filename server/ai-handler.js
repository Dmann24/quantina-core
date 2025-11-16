// ===============================================
// Quantina AI Handler (v3.1) — Smart Multilingual Replies
// ===============================================
import express from "express";
import OpenAI from "openai";

const router = express.Router();

// Lazy initialize OpenAI (so it's not loaded before .env)
let openai;

function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY not found in environment!");
      throw new Error("Missing OpenAI API key");
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log("✅ OpenAI client initialized");
  }
  return openai;
}

// =================================================
// Route: /api/ai-chat
// =================================================
router.post("/ai-chat", async (req, res) => {
  try {
    console.log("✅ /api/ai-chat hit successfully!");
    const { message, text } = req.body;
    const content = text || message;

    if (!content) {
      return res.status(400).json({ success: false, error: "Missing message text" });
    }

    // Initialize client lazily
    const ai = getOpenAI();

    // 🧠 Ask OpenAI to detect language and reply naturally
    const completion = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are Quantina AI, a multilingual smart assistant.
            - Detect the user's language.
            - Respond naturally in the same language.
            - Keep your responses conversational and concise.
          `,
        },
        {
          role: "user",
          content,
        },
      ],
    });

    const reply = completion.choices[0].message.content;

    res.json({
      success: true,
      received: content,
      reply,
    });
  } catch (error) {
    console.error("❌ AI Chat Error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
