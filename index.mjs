// =============================================================
// 🌐 Quantina Core AI Translation Relay v2.6
//  - Supports text + voice (MP3/WAV)
//  - Auto language detection (sender)
//  - Output-side translation (receiver)
//  - Whisper + GPT-4o-mini powered
// =============================================================

import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============================================================
// 🗂️ File Upload Setup (Multer)
// =============================================================
const upload = multer({ dest: "uploads/" });

// =============================================================
// 🧠 Helper: Detect language of a given text
// =============================================================
async function detectLanguage(text) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a language detection expert. Identify the language of this text. Respond with only the language name (like English, Punjabi, French, Hindi)."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await response.json();
    const language = data?.choices?.[0]?.message?.content?.trim() || "Unknown";
    return language;
  } catch (err) {
    console.error("❌ Language detection error:", err);
    return "Unknown";
  }
}

// =============================================================
// 🧠 Helper: Translate text to target language
// =============================================================
async function translateText(text, targetLang = "English") {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a translator. Translate the user's message into ${targetLang}. Return only the translated text.`
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await response.json();
    const translated = data?.choices?.[0]?.message?.content?.trim() || text;
    return translated;
  } catch (err) {
    console.error("❌ Translation error:", err);
    return text;
  }
}

// =============================================================
// 🎙️ Helper: Transcribe Audio (Whisper via GPT-4o-mini-transcribe)
// =============================================================
async function transcribeAudio(filePath) {
  try {
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append("file", fileStream);
    formData.append("model", "gpt-4o-mini-transcribe");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const data = await response.json();
    return data.text || "";
  } catch (err) {
    console.error("❌ Transcription error:", err);
    return "";
  }
}

// =============================================================
// 🔁 POST: /api/peer-message
// Handles text + voice messages between users
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, text, mode } = req.body;
    let transcribedText = "";
    let originalText = text || "";

    // If mode is voice, transcribe the uploaded file
    if (mode === "voice" && req.file) {
      console.log(`🎤 Voice received from ${sender_id}: ${req.file.path}`);
      transcribedText = await transcribeAudio(req.file.path);
      fs.unlinkSync(req.file.path); // clean up temp file
    }

    const finalInput = transcribedText || originalText;
    const senderLang = await detectLanguage(finalInput);
    const receiverLang = "English"; // TODO: fetch from DB or user settings
    const translated = await translateText(finalInput, receiverLang);

    console.log(`✅ Message processed (${mode}) from ${sender_id} → ${receiver_id}`);

    return res.json({
      success: true,
      sender_language: senderLang,
      receiver_language: receiverLang,
      original: finalInput,
      translated
    });
  } catch (err) {
    console.error("❌ /api/peer-message failed:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================
// 🌍 GET: Root Route — simple status page
// =============================================================
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Core Active</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:120px;">
        <h1>🤖 Quantina AI Core Running</h1>
        <p>Status: <b>Online</b></p>
        <p>Send POST requests to <code>/api/peer-message</code></p>
        <p>Build v2.6 — Auto-detect + Translation Layer Enabled</p>
      </body>
    </html>
  `);
});

// =============================================================
// 🚀 Start Server
// =============================================================
app.listen(PORT, () => {
  console.log(`✅ Quantina AI Relay running on port ${PORT}`);
});
