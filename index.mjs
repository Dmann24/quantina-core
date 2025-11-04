// =============================================================
// 🌐 Quantina Core AI Translation Relay v3.0
//  - Text + Voice support
//  - Auto language detection (sender)
//  - Dynamic receiver language memory (JSON-based)
//  - Output-side translation via GPT-4o-mini
//  - Whisper for speech transcription
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
// 📁 Ensure data folder exists
// =============================================================
if (!fs.existsSync("data")) fs.mkdirSync("data");
const USER_FILE = "data/users.json";
if (!fs.existsSync(USER_FILE)) fs.writeFileSync(USER_FILE, JSON.stringify({}, null, 2));

// =============================================================
// 🗂️ File Upload Setup (Multer)
// =============================================================
const upload = multer({ dest: "uploads/" });

// =============================================================
// 📚 Helper: Load and Save User Language Preferences
// =============================================================
function loadUsers() {
  return JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}

// =============================================================
// 🧠 Helper: Detect language of text
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
              "You are a language detection expert. Identify the language of this text. Respond with only the language name (English, Punjabi, French, etc.)."
          },
          { role: "user", content: text }
        ]
      })
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "Unknown";
  } catch (err) {
    console.error("❌ detectLanguage error:", err);
    return "Unknown";
  }
}

// =============================================================
// 🧠 Helper: Translate text to a target language
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
            content: `You are a professional translator. Translate the message into ${targetLang}. Return only the translated text.`
          },
          { role: "user", content: text }
        ]
      })
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    console.error("❌ translateText error:", err);
    return text;
  }
}

// =============================================================
// 🎙️ Helper: Transcribe Audio using Whisper
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
// 🔁 POST /api/peer-message — Text or Voice Translation Layer
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, text, mode } = req.body;
    let transcribedText = "";
    let finalText = text || "";

    // 🔊 Handle voice mode
    if (mode === "voice" && req.file) {
      console.log(`🎤 Voice received from ${sender_id}: ${req.file.path}`);
      transcribedText = await transcribeAudio(req.file.path);
      fs.unlinkSync(req.file.path);
    }

    finalText = transcribedText || finalText;

    // 🔍 Detect sender language
    const senderLang = await detectLanguage(finalText);

    // 💾 Get receiver's preferred language from memory
    const users = loadUsers();
    const receiverLang = users[receiver_id]?.preferred_lang || "English";

    // 🔄 Translate text
    const translated = await translateText(finalText, receiverLang);

    // 🧭 Save sender language preference
    users[sender_id] = users[sender_id] || {};
    users[sender_id].preferred_lang = senderLang;
    saveUsers(users);

    console.log(`✅ Processed (${mode}) ${sender_id} → ${receiver_id}`);

    res.json({
      success: true,
      sender_language: senderLang,
      receiver_language: receiverLang,
      original: finalText,
      translated
    });
  } catch (err) {
    console.error("❌ /api/peer-message failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================
// 🌍 GET /api/users — View current language memory
// =============================================================
app.get("/api/users", (req, res) => {
  res.json(loadUsers());
});

// =============================================================
// 🌐 Root page (status)
// =============================================================
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Core v3.0</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:120px;">
        <h1>🤖 Quantina Core AI Translation Relay v3.0</h1>
        <p>Status: <b>Online</b></p>
        <p>POST → <code>/api/peer-message</code></p>
        <p>GET → <code>/api/users</code> (to view memory)</p>
      </body>
    </html>
  `);
});

// =============================================================
// 🚀 Start server
// =============================================================
app.listen(PORT, () => {
  console.log(`✅ Quantina Core AI Relay v3.0 running on port ${PORT}`);
});
