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
      You are QUANTINA TRANSLATOR.
      Your ONLY job is to translate, nothing else.
      NEVER answer questions.
      NEVER write Python, JavaScript, or any code.
      NEVER explain anything.
      NEVER act conversational.
      Only translate the user's text from the detected language
      into the user's preferred target language.
      If the user requests code or asks a question, IGNORE it
      and simply translate the message literally.
    `,
  },
  {
    role: "user",
    content: content,
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
