// =========================================================
// Quantina Messenger Core (Railway Build v1.2.0 Stable)
// Express + Socket.IO + SQLite + OpenAI (gpt-4o-mini)
// =========================================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// ---------------------------------------------------------
// Environment Setup
// ---------------------------------------------------------
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------
// Express Setup
// ---------------------------------------------------------
const app = express();
app.use(cors());

// ✅ Conditional JSON parser — skip for file uploads
app.use((req, res, next) => {
  if (req.is("multipart/form-data")) return next();
  express.json()(req, res, next);
});

// ---------------------------------------------------------
// Multer Setup (File Upload Middleware)
// ---------------------------------------------------------
const upload = multer({ dest: "uploads/" });

// ---------------------------------------------------------
// OpenAI Setup
// ---------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------
// SQLite Setup
// ---------------------------------------------------------
const dbPath = path.join(__dirname, "quantina_chat.sqlite");
const db = await open({
  filename: dbPath,
  driver: sqlite3.Database,
});

// Create tables if not exist
await db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    body_original TEXT,
    body_translated TEXT,
    detected_language TEXT,
    receiver_language TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id TEXT PRIMARY KEY,
    preferred_language TEXT DEFAULT 'English'
  );
`);

// ---------------------------------------------------------
// Core Helper Functions
// ---------------------------------------------------------
async function getUserPreferredLanguage(userId) {
  const row = await db.get("SELECT preferred_language FROM user_prefs WHERE user_id = ?", [userId]);
  if (row && row.preferred_language) return row.preferred_language;

  await db.run("INSERT OR REPLACE INTO user_prefs (user_id, preferred_language) VALUES (?, ?)", [
    userId,
    "English",
  ]);
  return "English";
}

async function detectLanguageOfText(text) {
  if (!text?.trim()) return "Unknown";
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Detect the language name only (English, Punjabi, etc.)" },
      { role: "user", content: text },
    ],
  });
  return completion?.choices?.[0]?.message?.content?.trim() || "Unknown";
}

async function translateTextIfNeeded(originalText, fromLang, toLang) {
  if (fromLang.toLowerCase() === toLang.toLowerCase()) return originalText;

  const translation = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `Translate this text naturally from ${fromLang} to ${toLang}.` },
      { role: "user", content: originalText },
    ],
  });

  return translation?.choices?.[0]?.message?.content?.trim() || originalText;
}

async function processPeerMessage({ senderId, receiverId, rawText }) {
  const detectedLang = await detectLanguageOfText(rawText);
  const receiverLang = await getUserPreferredLanguage(receiverId);
  const translatedText = await translateTextIfNeeded(rawText, detectedLang, receiverLang);

  const timestamp = new Date().toISOString();

  await db.run(
    `INSERT INTO messages (sender_id, receiver_id, body_original, body_translated, detected_language, receiver_language, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [senderId, receiverId, rawText, translatedText, detectedLang, receiverLang, timestamp]
  );

  return {
    success: true,
    mode: "text",
    body_original: rawText,
    body_translated: translatedText,
    detected_language: detectedLang,
    receiver_language: receiverLang,
    created_at: timestamp,
  };
}

// ---------------------------------------------------------
// Voice Transcription Route
// ---------------------------------------------------------
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    // 🎤 If audio present — handle voice mode
    if (req.file) {
      console.log("🎙️ Voice file received:", req.file.path);
      const audioBuffer = fs.readFileSync(req.file.path);

import fetch, { FormData, fileFromSync } from "node-fetch";
import fs from "fs";

// Native fetch and FormData are already available in Node 18 +
const formData = new FormData();
formData.append("model", "gpt-4o-mini-transcribe");
formData.append("file", new Blob([fs.readFileSync(audioPath)]), "audio.mp3");

const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: formData,
});

if (!response.ok) {
  const err = await response.text();
  console.error("❌ Transcription Error:", err);
  throw new Error("Failed to transcribe audio");
}

const transcription = await response.json();
console.log("✅ Transcription Result:", transcription.text);

// (optional cleanup)
fs.unlink(audioPath, (err) => {
  if (err) console.warn("⚠️ Could not delete uploaded file:", err);
});

    }

    // 💬 If text message
    const { sender_id, receiver_id, text } = req.body;
    if (!sender_id || !receiver_id || !text) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    const result = await processPeerMessage({
      senderId: sender_id,
      receiverId: receiver_id,
      rawText: text,
    });

    res.json(result);
  } catch (err) {
    console.error("❌ Error in /api/peer-message:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------
// Health Check
// ---------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---------------------------------------------------------
// Socket.IO Setup
// ---------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  const userId = socket.handshake.auth?.token || "guest_" + socket.id;
  console.log(`🟢 Socket connected: ${userId}`);

  socket.join(userId);

  socket.on("send_message", async (payload) => {
    try {
      const { fromUserId, toUserId, body } = payload || {};
      if (!fromUserId || !toUserId || !body) return;

      const processed = await processPeerMessage({
        senderId: fromUserId,
        receiverId: toUserId,
        rawText: body,
      });

      io.to(toUserId).emit("receive_message", processed);
      socket.emit("message_sent", processed);
    } catch (err) {
      socket.emit("message_error", { error: err.message });
    }
  });

  socket.on("disconnect", () => console.log(`🔴 Socket disconnected: ${userId}`));
});

// ---------------------------------------------------------
// Start Server
// ---------------------------------------------------------
const PORT = process.env.PORT || 4001;
server.listen(PORT, () => {
  console.log(`🚀 Quantina Core live on port ${PORT}`);
  console.log(`🌐 API: https://quantina-core-production.up.railway.app/api/peer-message`);
});
