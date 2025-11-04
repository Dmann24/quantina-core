// ===========================================================
// Quantina Chat Server v1.2 — Stable Voice + Text API
// ===========================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { Server } from "socket.io";
import http from "http";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import OpenAI from "openai";

// ===========================================================
// 🌍 Environment Setup
// ===========================================================
dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});
app.use(cors());
app.use(express.json());

// ===========================================================
// 📂 File Upload (multer)
// ===========================================================
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

// ===========================================================
// 💾 SQLite Database
// ===========================================================
let db;
(async () => {
  db = await open({
    filename: "./quantina_chat.db",
    driver: sqlite3.Database,
  });

  await db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT,
      receiver_id TEXT,
      mode TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ SQLite connected & table ready");
})();


// ===========================================================
// 🤖 OpenAI Client
// ===========================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===========================================================
// 📩 API Route: /api/peer-message
// ===========================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, mode } = req.body;

    if (mode === "voice" && req.file) {
      console.log("🎧 Voice message received:", req.file.path);

      const audioPath = req.file.path;
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
        const errText = await response.text();
        console.error("❌ Transcription failed:", errText);
        throw new Error("Transcription failed");
      }

      const data = await response.json();
      const transcription = data.text;
      console.log("✅ Transcription:", transcription);

      await db.run(
        "INSERT INTO messages (sender_id, receiver_id, mode, content) VALUES (?, ?, ?, ?)",
        [sender_id, receiver_id, "voice", transcription]
      );

      fs.unlink(audioPath, (err) => {
        if (err) console.warn("⚠️ Could not delete temp file:", err);
      });

      io.emit("message", { sender_id, receiver_id, mode: "voice", content: transcription });
      return res.json({ success: true, message: transcription });
    }

    // 💬 Text Mode
    if (mode === "text") {
      const { content } = req.body;
      if (!content) return res.status(400).json({ success: false, error: "Missing text content" });

      await db.run(
        "INSERT INTO messages (sender_id, receiver_id, mode, content) VALUES (?, ?, ?, ?)",
        [sender_id, receiver_id, "text", content]
      );

      io.emit("message", { sender_id, receiver_id, mode: "text", content });
      return res.json({ success: true });
    }

    res.status(400).json({ success: false, error: "Invalid mode or missing audio file" });
  } catch (err) {
    console.error("❌ Error in /api/peer-message:", err);
    res.status(500).json({ success: false, error: err.message || "Internal Server Error" });
  }
});

// ===========================================================
// 🔌 Socket.IO Connections
// ===========================================================
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);
  socket.on("disconnect", () => console.log("🔌 User disconnected:", socket.id));
});

// ===========================================================
// 🚀 Start Server
// ===========================================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Quantina Chat Server running on port ${PORT}`));
