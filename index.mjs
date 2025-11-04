// =============================================================
// 🌐 Quantina Core AI Translation Relay v3.1 (Stable Build)
//  - Text + Voice support
//  - Auto language detection via GPT-4o-mini
//  - Dynamic receiver language memory (JSON-based)
//  - Whisper for voice transcription
//  - Serves static /langs for frontend chat widget
// =============================================================

import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import dotenv from "dotenv";
import FormData from "form-data";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Serve static language directory for chat widget
app.use("/langs", express.static("public/langs"));


// =============================================================
// 📁 Ensure data folders exist
// =============================================================
if (!fs.existsSync("data")) fs.mkdirSync("data");
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
const USER_FILE = "data/users.json";
if (!fs.existsSync(USER_FILE)) fs.writeFileSync(USER_FILE, JSON.stringify({}, null, 2));

// =============================================================
// 🗂️ File Upload Setup (Multer)
// =============================================================
const upload = multer({ dest: "uploads/" });

// =============================================================
// 🧠 Helper: Load and Save User Language Preferences
// =============================================================
function loadUsers() {
  return JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
}
function saveUsers(users) {
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}

// =============================================================
// 🎙️ Helper: Transcribe Audio (Whisper)
// =============================================================
async function transcribeAudio(filePath) {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));
    formData.append("model", "gpt-4o-mini-transcribe");
    formData.append("response_format", "json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    const data = await response.json();
    if (!data.text || data.text.trim().length === 0) {
      console.warn("⚠️ Whisper returned no text — check audio clarity or format");
      return "";
    }
    return data.text.trim();
  } catch (err) {
    console.error("❌ Transcription error:", err);
    return "";
  }
}

// =============================================================
// 🧠 Helper: Detect language of a message
// =============================================================
async function detectLanguage(text) {
  if (!text || text.trim().length === 0) return "Unknown";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a language detection expert. Identify the language of the following text. Respond with the full English name only (e.g. 'Punjabi', 'English', 'French').",
          },
          { role: "user", content: text },
        ],
      }),
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "Unknown";
  } catch (err) {
    console.error("❌ detectLanguage error:", err);
    return "Unknown";
  }
}

// =============================================================
// 🌍 Helper: Translate text to target language
// =============================================================
async function translateText(text, targetLang = "English") {
  if (!text || text.trim().length === 0)
    return "It seems there is no message to translate. Please provide text to translate.";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate the following text into ${targetLang}. Return only the translated content.`,
          },
          { role: "user", content: text },
        ],
      }),
    });

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch (err) {
    console.error("❌ translateText error:", err);
    return text;
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

    // 🎧 Handle voice mode
    if (mode === "voice" && req.file) {
      console.log(`🎤 Voice received from ${sender_id}: ${req.file.path}`);
      transcribedText = await transcribeAudio(req.file.path);
      fs.unlinkSync(req.file.path); // cleanup
    }

    finalText = transcribedText || finalText;
    const senderLang = await detectLanguage(finalText);

    // Get receiver language memory
    const users = loadUsers();
    const receiverLang = users[receiver_id]?.preferred_lang || "English";

    // Translate text
    const translated = await translateText(finalText, receiverLang);

    // Update sender language memory
    users[sender_id] = users[sender_id] || {};
    users[sender_id].preferred_lang = senderLang;
    saveUsers(users);

    console.log(`✅ Processed (${mode || "text"}) ${sender_id} → ${receiver_id}`);

    res.json({
      success: true,
      sender_language: senderLang,
      receiver_language: receiverLang,
      original: finalText,
      translated,
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
// 🌐 Root status page
// =============================================================
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Core v3.1</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:120px;">
        <h1>🤖 Quantina Core AI Translation Relay v3.1</h1>
        <p>Status: <b>Online</b></p>
        <p>Send POST requests to <code>/api/peer-message</code></p>
        <p>View user memory: <code>/api/users</code></p>
        <p>Static languages: <code>/langs/quantina_languages.json</code></p>
      </body>
    </html>
  `);
});

// =============================================================
// 🚀 Start server
// =============================================================
app.listen(PORT, () => {
  console.log(`✅ Quantina Core AI Relay v3.1 running on port ${PORT}`);
});
