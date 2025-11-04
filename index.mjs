// ============================================================
// Quantina Messenger - Multilingual AI Relay (v2.1 FINAL)
// Author: Quantina Core | Built for Railway + LocalWP Proxy
// ============================================================

import express from "express";
import http from "http";
import cors from "cors";
import multer from "multer";
import { Server } from "socket.io";
import dotenv from "dotenv";
import OpenAI from "openai";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs/promises";

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ============================================================
// 🧠 SQLite Setup
// ============================================================
const db = await open({
  filename: "./quantina.db",
  driver: sqlite3.Database,
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    mode TEXT,
    language TEXT,
    content TEXT,
    translated TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    preferred_language TEXT DEFAULT 'English'
  )
`);

// ============================================================
// 📦 File Upload Setup (Multer)
// ============================================================
const upload = multer({ dest: "uploads/" });
app.use(cors());
app.use(express.json());

// ============================================================
// 🧭 Helper: Translate message if needed
// ============================================================
async function translateIfNeeded(text, sourceLang, targetLang) {
  if (!text || sourceLang === targetLang) return text;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a precise translator. Translate from ${sourceLang} to ${targetLang}, keeping tone and meaning intact.`,
      },
      { role: "user", content: text },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || text;
}

// ============================================================
// 🗣️ Route: /api/peer-message
// ============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, mode } = req.body;
    let originalText = "";
    let detectedLang = "Unknown";

    // ========================================================
    // 🎧 Handle voice mode
    // ========================================================
    if (mode === "voice" && req.file) {
      console.log(`🎤 Voice received from ${sender_id}:`, req.file.path);

      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(req.file.path),
        model: "gpt-4o-mini-transcribe",
      });

      originalText = transcription.text.trim();
      detectedLang = transcription.language || "Unknown";
      await fs.unlink(req.file.path).catch(() => {});
    }

    // ========================================================
    // 💬 Handle text mode
    // ========================================================
    if (mode === "text" && req.body.message) {
      originalText = req.body.message;
      // detect source language
      const detection = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Detect the language of this text:" },
          { role: "user", content: originalText },
        ],
      });
      detectedLang = detection.choices[0].message.content.trim();
    }

    // ========================================================
    // 🌍 Fetch receiver preference
    // ========================================================
    const receiver = await db.get(
      "SELECT preferred_language FROM users WHERE id = ?",
      [receiver_id]
    );
    const receiverLang = receiver?.preferred_language || "English";

    // ========================================================
    // 🔄 Translate output for receiver
    // ========================================================
    const translatedText = await translateIfNeeded(
      originalText,
      detectedLang,
      receiverLang
    );

    // ========================================================
    // 💾 Save to database
    // ========================================================
    await db.run(
      `INSERT INTO messages (sender_id, receiver_id, mode, language, content, translated)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sender_id, receiver_id, mode, detectedLang, originalText, translatedText]
    );

    // ========================================================
    // 📡 Emit to receiver
    // ========================================================
    io.emit("new_message", {
      sender_id,
      receiver_id,
      mode,
      original: originalText,
      translated: translatedText,
      detectedLang,
      receiverLang,
    });

    return res.json({
      success: true,
      sender_language: detectedLang,
      receiver_language: receiverLang,
      original: originalText,
      translated: translatedText,
    });
  } catch (err) {
    console.error("❌ /api/peer-message failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ============================================================
// 🧩 Socket.IO Basic Listener
// ============================================================
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
  socket.on("disconnect", () => console.log("❌ User disconnected:", socket.id));
});

// ============================================================
// 🚀 Start Server
// ============================================================
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`✅ Quantina AI Relay running on port ${PORT}`));
