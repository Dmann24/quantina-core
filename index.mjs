// =============================================================
// 🌐 Quantina Core AI Translation Relay v3.3
//  - Text + Voice support
//  - Auto language detection (sender)
//  - Dynamic receiver language memory
//  - SQLite + JSON hybrid persistence
//  - Output-side translation via GPT-4o-mini
//  - Whisper for speech transcription (with ffmpeg re-encode)
// =============================================================

import express from "express";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";
import { execSync } from "child_process";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/langs", express.static("langs"));

// =============================================================
// 📁 Ensure data folder exists
// =============================================================
if (!fs.existsSync("data")) fs.mkdirSync("data");
const USER_FILE = "data/users.json";
if (!fs.existsSync(USER_FILE)) fs.writeFileSync(USER_FILE, JSON.stringify({}, null, 2));

// =============================================================
// 🧩 Hybrid persistence (SQLite + JSON fallback)
// =============================================================
let db = null;
let usingSQLite = false;

try {
  const sqlite3 = (await import("sqlite3")).default;
  const { open } = await import("sqlite");

  db = await open({
    filename: "./data/quantina.db",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      preferred_lang TEXT
    )
  `);

  console.log("✅ SQLite tables are ready");
  usingSQLite = true;
} catch (err) {
  console.warn("⚠️ SQLite unavailable — using JSON fallback");
  usingSQLite = false;
}

// =============================================================
// 🧠 Hybrid User Language Helpers
// =============================================================
async function getUserLang(id) {
  if (usingSQLite && db) {
    const row = await db.get("SELECT preferred_lang FROM users WHERE id = ?", [id]);
    return row?.preferred_lang || "English";
  }
  const users = JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
  return users[id]?.preferred_lang || "English";
}

async function setUserLang(id, lang) {
  if (usingSQLite && db) {
    await db.run("INSERT OR REPLACE INTO users (id, preferred_lang) VALUES (?, ?)", [id, lang]);
  } else {
    const users = JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
    users[id] = { preferred_lang: lang };
    fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
  }
}

// =============================================================
// 🎙️ Safe Transcribe Audio (Whisper + ffmpeg conversion)
// =============================================================
async function transcribeAudio(filePath) {
  try {
    const tempWav = `${filePath}.wav`;
    execSync(`ffmpeg -y -i ${filePath} -ac 1 -ar 16000 ${tempWav}`);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(tempWav));
    formData.append("model", "gpt-4o-mini-transcribe");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });

    const data = await response.json();

    fs.unlinkSync(filePath);
    fs.unlinkSync(tempWav);

    if (!data.text || !data.text.trim()) {
      console.warn("⚠️ Whisper returned no text — check audio clarity");
      return "";
    }

    return data.text.trim();
  } catch (err) {
    console.error("❌ Transcription error:", err);
    return "";
  }
}

// =============================================================
// 🧠 Language Detection (via GPT)
// =============================================================
async function detectLanguage(text) {
  if (!text || text.trim().length === 0) return "Unknown";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a language detector. Identify the language name only (e.g., English, French, Punjabi)."
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
// 🌍 Translation Layer (GPT-4o-mini)
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

    const result = await response.json();
    const translatedText = result?.choices?.[0]?.message?.content?.trim();

    if (!translatedText) {
      console.warn("⚠️ No translation found, returning original text.");
      return text;
    }

    return translatedText;
  } catch (err) {
    console.error("❌ translateText error:", err);
    return text;
  }
}

// =============================================================
// 📦 File Upload Handler (Multer)
// =============================================================
const upload = multer({ dest: "uploads/" });

// =============================================================
// 🔁 Main Endpoint: /api/peer-message
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, text, mode } = req.body;
    let message = text || "";

    if (mode === "voice" && req.file) {
      console.log(`🎤 Voice received from ${sender_id}: ${req.file.path}`);
      message = await transcribeAudio(req.file.path);
    }

    const senderLang = await detectLanguage(message);
    const receiverLang = await getUserLang(receiver_id);
    const translated = await translateText(message, receiverLang);

    await setUserLang(sender_id, senderLang);

    console.log(`✅ Processed (${mode}) ${sender_id} → ${receiver_id}`);

    res.json({
      success: true,
      sender_language: senderLang,
      receiver_language: receiverLang,
      original: message,
      translated
    });
  } catch (err) {
    console.error("❌ /api/peer-message failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================================
// 🌍 Utility Routes
// =============================================================
app.get("/api/users", async (req, res) => {
  if (usingSQLite && db) {
    const rows = await db.all("SELECT * FROM users");
    res.json(rows);
  } else {
    res.json(JSON.parse(fs.readFileSync(USER_FILE, "utf8")));
  }
});

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Core v3.3</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:120px;">
        <h1>🤖 Quantina Core AI Translation Relay v3.3</h1>
        <p>Status: <b>Online</b></p>
        <p>Persistence: ${usingSQLite ? "SQLite Database" : "JSON Memory"}</p>
        <p>POST endpoint: <code>/api/peer-message</code></p>
        <p>GET users: <code>/api/users</code></p>
      </body>
    </html>
  `);
});

// =============================================================
// 🚀 Start Server
// =============================================================
app.listen(PORT, () => {
  console.log(`✅ Quantina Core AI Relay v3.3 running on port ${PORT}`);
});
