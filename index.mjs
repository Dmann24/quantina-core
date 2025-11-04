// =========================================================
// Quantina AI Relay (v2.3) — Voice + Translation Layer
// Express + Socket.IO + SQLite + OpenAI Whisper + GPT-4o
// =========================================================

import express from "express";
import http from "http";
import cors from "cors";
import multer from "multer";
import { Server } from "socket.io";
import dotenv from "dotenv";
import * as fs from "fs";
import fsPromises from "fs/promises";
import FormData from "form-data";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

// =========================================================
// Initialize Express + Socket.IO
// =========================================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// =========================================================
// Database setup
// =========================================================
const db = await open({
  filename: "./quantina_messages.db",
  driver: sqlite3.Database,
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    mode TEXT,
    original TEXT,
    translated TEXT,
    sender_language TEXT,
    receiver_language TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// =========================================================
// Multer setup for file uploads
// =========================================================
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// ==============================================
// 🧠 Helper: Detect the language of input text
// ==============================================
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
              "You are a language detection expert. Identify the language of the given text. Respond with only the language name, like 'English', 'Punjabi', 'French', 'Hindi'."
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



// =========================================================
// 🎤 POST /api/peer-message — handle text + voice
// =========================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, mode, text } = req.body;

    let originalText = text || "";
    let translatedText = "";
    let senderLang = "Unknown";
    let receiverLang = "English";

    // 🎧 Voice transcription (Whisper)
    if (mode === "voice" && req.file) {
      console.log("🎤 Voice received from", sender_id, ":", req.file.path);

      const audioFile = fs.createReadStream(req.file.path);
      const form = new FormData();
      form.append("model", "gpt-4o-mini-transcribe");
      form.append("file", audioFile);

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: form,
      });

      const data = await response.json();
      if (data.text) {
        originalText = data.text.trim();
      } else {
        throw new Error(data.error?.message || "Transcription failed");
      }

      await fsPromises.unlink(req.file.path).catch(() => {});
    }

    // 🌍 Translation step
    translatedText = await translateText(originalText, receiverLang);

    // 💾 Save to DB
    await db.run(
      `INSERT INTO messages (sender_id, receiver_id, mode, original, translated, sender_language, receiver_language)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sender_id, receiver_id, mode, originalText, translatedText, senderLang, receiverLang]
    );

    // 📡 Notify both users in real-time
    io.emit("new_message", {
      sender_id,
      receiver_id,
      mode,
      original: originalText,
      translated: translatedText,
    });

    console.log(`✅ Message processed (${mode}) from ${sender_id} → ${receiver_id}`);

   res.json({
  success: true,
  sender_language: senderLang,
  receiver_language: receiverLang,
  original: transcribedText || text,
  translated
});

  } catch (err) {
    console.error("❌ /api/peer-message failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================
// Socket.IO Live connection
// =========================================================
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);
  socket.on("disconnect", () => console.log("🔴 User disconnected:", socket.id));
});

// =========================================================
// Start server
// =========================================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`✅ Quantina AI Relay running on port ${PORT}`));
// Serve the main frontend if someone visits root URL
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Chat</title></head>
      <body style="font-family:sans-serif;text-align:center;margin-top:100px;">
        <h1>🤖 Quantina Core Active</h1>
        <p>The AI Translation Chat backend is online.</p>
        <p>Use <b>/api/peer-message</b> via POST to send messages.</p>
      </body>
    </html>
  `);
});
