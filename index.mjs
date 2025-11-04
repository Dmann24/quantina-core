// =========================================================
// Quantina Messenger Core (Railway Build v1.1 Voice Ready)
// Express + Socket.IO + SQLite + OpenAI (gpt-4o-mini)
// =========================================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";

// ---------------------------------------------------------
// 🧩 Environment + Diagnostics
// ---------------------------------------------------------
dotenv.config();

console.log("=== 🧠 Quantina Diagnostic Start ===");
console.log("📦 Current Directory:", process.cwd());
console.log("🌍 Environment Variables:", Object.keys(process.env));
console.log("🔑 OpenAI Key Present:", !!process.env.OPENAI_API_KEY);
console.log("📄 Files in directory:", fs.readdirSync("."));
console.log("=== ✅ Diagnostic Complete ===");

// ---------------------------------------------------------
// Path + ENV setup
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

// ---------------------------------------------------------
// Core constants
// ---------------------------------------------------------
const PORT = process.env.PORT || 4001;
const DEFAULT_LANG = "English";
const DEFAULT_PLAN = "FREE";
const MODEL_TRANSLATE = "gpt-4o-mini";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing. Set it in Railway env vars.");
}

// ---------------------------------------------------------
// 🧹 Cleanup outdated SQLite schema (auto fix)
// ---------------------------------------------------------
const dbPath = path.join(__dirname, "quantina_chat.sqlite");
if (fs.existsSync(dbPath)) {
  const dbText = fs.readFileSync(dbPath, "utf8");
  if (!dbText.includes("body_original")) {
    console.log("🧹 Old DB schema detected — deleting quantina_chat.sqlite...");
    fs.unlinkSync(dbPath);
  }
}

// ---------------------------------------------------------
// Express + HTTP + Socket.IO setup
// ---------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "public")));
app.use("/assets/langs", express.static(path.join(__dirname, "public", "langs")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ---------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------
// SQLite Setup
// ---------------------------------------------------------
const db = await open({
  filename: dbPath,
  driver: sqlite3.Database,
});

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
    preferred_language TEXT DEFAULT '${DEFAULT_LANG}'
  );
`);

await db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    user_id TEXT PRIMARY KEY,
    plan TEXT DEFAULT '${DEFAULT_PLAN}',
    messages_used INTEGER DEFAULT 0,
    limit_per_month INTEGER DEFAULT 500,
    renewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log("✅ SQLite tables are ready");

// ---------------------------------------------------------
// Helpers: DB + AI Utilities
// ---------------------------------------------------------
async function getUserPreferredLanguage(userId) {
  const row = await db.get("SELECT preferred_language FROM user_prefs WHERE user_id = ?", [userId]);
  if (row && row.preferred_language) return row.preferred_language;

  await db.run("INSERT OR REPLACE INTO user_prefs (user_id, preferred_language) VALUES (?, ?)", [
    userId,
    DEFAULT_LANG,
  ]);
  return DEFAULT_LANG;
}

async function setUserPreferredLanguage(userId, lang) {
  await db.run("INSERT OR REPLACE INTO user_prefs (user_id, preferred_language) VALUES (?, ?)", [
    userId,
    lang,
  ]);
}

async function getUserPlan(userId) {
  const row = await db.get(
    "SELECT plan, messages_used, limit_per_month, renewed_at FROM plans WHERE user_id = ?",
    [userId]
  );
  if (row) return row;

  await db.run(
    "INSERT OR REPLACE INTO plans (user_id, plan, messages_used, limit_per_month) VALUES (?, ?, ?, ?)",
    [userId, DEFAULT_PLAN, 0, 500]
  );

  return { plan: DEFAULT_PLAN, messages_used: 0, limit_per_month: 500, renewed_at: new Date().toISOString() };
}

async function incrementUserUsage(userId) {
  await db.run("UPDATE plans SET messages_used = messages_used + 1 WHERE user_id = ?", [userId]);
}

async function detectLanguageOfText(text) {
  if (!text || text.trim().length === 0) return "Unknown";

  const completion = await openai.chat.completions.create({
    model: MODEL_TRANSLATE,
    messages: [
      { role: "system", content: "Detect the language name only (English, Punjabi, French, etc.)" },
      { role: "user", content: text },
    ],
  });

  return completion?.choices?.[0]?.message?.content?.trim() || "Unknown";
}

async function translateTextIfNeeded(originalText, fromLang, toLang) {
  if (!originalText.trim()) return "(empty message)";
  if (fromLang.toLowerCase() === toLang.toLowerCase()) return originalText;

  const translation = await openai.chat.completions.create({
    model: MODEL_TRANSLATE,
    messages: [
      { role: "system", content: `Translate from ${fromLang} to ${toLang} naturally.` },
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

  await incrementUserUsage(senderId);
  return {
    body_original: rawText,
    body_translated: translatedText,
    detected_language: detectedLang,
    receiver_language: receiverLang,
    created_at: timestamp,
  };
}

// ---------------------------------------------------------
// REST API ROUTES
// ---------------------------------------------------------
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 💬 JSON Text Chat
app.post("/api/peer-message", async (req, res) => {
  try {
    const { sender_id, receiver_id, text } = req.body;
    if (!sender_id || !receiver_id || !text)
      return res.status(400).json({ success: false, error: "Missing sender_id, receiver_id or text" });

    const result = await processPeerMessage({ senderId: sender_id, receiverId: receiver_id, rawText: text });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ /api/peer-message:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🎙️ Voice Upload Endpoint
const upload = multer({ dest: "uploads/" });

app.post("/api/peer-message/audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No audio file found" });

    console.log("🎙️ Voice file received:", req.file.path);
    const audioBuffer = fs.readFileSync(req.file.path);

    const transcription = await openai.audio.transcriptions.create({
      file: audioBuffer,
      model: "gpt-4o-mini-transcribe",
    });

    const text = transcription.text || "";
    console.log("✅ Transcribed:", text);

    const result = await processPeerMessage({
      senderId: req.body.sender_id || "unknown",
      receiverId: req.body.receiver_id || "unknown",
      rawText: text,
    });

    fs.unlink(req.file.path, () => {}); // cleanup temp file

    res.json({
      success: true,
      mode: "voice",
      transcribed: text,
      ...result,
    });
  } catch (err) {
    console.error("❌ Voice processing error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------
// SOCKET.IO Realtime Messaging
// ---------------------------------------------------------
io.on("connection", (socket) => {
  const userId = socket.handshake.auth?.token || "guest_" + socket.id;
  console.log(`🟢 Socket connected: ${userId}`);

  getUserPreferredLanguage(userId).catch(() => {});
  getUserPlan(userId).catch(() => {});

  socket.join(userId);

  socket.on("send_message", async (payload) => {
    try {
      const { fromUserId, toUserId, body } = payload || {};
      if (!fromUserId || !toUserId || !body) return;

      const processed = await processPeerMessage({ senderId: fromUserId, receiverId: toUserId, rawText: body });
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
server.listen(PORT, () => {
  console.log(`🚀 Quantina Core live on port ${PORT}`);
  console.log(`🌐 API: https://quantina-core-production.up.railway.app/api/peer-message`);
  console.log(`🎙️ Voice API: https://quantina-core-production.up.railway.app/api/peer-message/audio`);
});
