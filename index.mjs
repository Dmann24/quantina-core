// =========================================================
// Quantina Messenger Core (Railway Build v1.0 FINAL)
// Express + Socket.IO + SQLite + OpenAI (gpt-4o-mini)
// =========================================================
//
// This server does:
//  - Runs 24/7 on Railway
//  - Handles real-time peer-to-peer messaging via Socket.IO
//  - Auto-translates between users' preferred languages
//  - Saves chat history, language prefs, and plan tier
//
// Env needed on Railway:
//   OPENAI_API_KEY=sk-xxxx
//   PORT=4001
//   NODE_ENV=production
//
// =========================================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import OpenAI from "openai";

// ---------------------------------------------------------
// Path + ENV setup
// ---------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env locally; Railway injects env automatically
dotenv.config({ path: path.resolve(__dirname, ".env") });

// ---------------------------------------------------------
// Core constants
// ---------------------------------------------------------
const PORT = process.env.PORT || 4001;
const DEFAULT_LANG = "English"; // fallback language for new users
const DEFAULT_PLAN = "FREE";    // FREE / PRO / ENTERPRISE (future billing)
const MODEL_TRANSLATE = "gpt-4o-mini";

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing. Set it in Railway env vars.");
}

// ---------------------------------------------------------
// Express app + middleware
// ---------------------------------------------------------
const app = express();

// ✅ Serve static files like JSON, CSS, JS, etc.
app.use(express.static(path.join(__dirname, "public")));

// ✅ Also serve same folder under /assets path
app.use("/assets", express.static(path.join(__dirname, "public")));

// ✅ Serve the langs directory explicitly for Railway
app.use("/assets/langs", express.static(path.join(__dirname, "public", "langs")));

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// Create HTTP server + Socket.IO
// ---------------------------------------------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // tighten later to https://yourdomain.com
    methods: ["GET", "POST"],
  },
});

// ---------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------
// SQLite Setup
// ---------------------------------------------------------
const db = await open({
  filename: path.join(__dirname, "quantina_chat.sqlite"),
  driver: sqlite3.Database,
});

// messages table
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

// user_prefs table: stores language pref per user
await db.exec(`
  CREATE TABLE IF NOT EXISTS user_prefs (
    user_id TEXT PRIMARY KEY,
    preferred_language TEXT DEFAULT '${DEFAULT_LANG}'
  );
`);

// plans table: stores plan tier + usage for throttling / upsell
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
// Helpers: DB + usage
// ---------------------------------------------------------
async function getUserPreferredLanguage(userId) {
  const row = await db.get(
    "SELECT preferred_language FROM user_prefs WHERE user_id = ?",
    [userId]
  );
  if (row && row.preferred_language) return row.preferred_language;

  // no row -> insert default
  await db.run(
    "INSERT OR REPLACE INTO user_prefs (user_id, preferred_language) VALUES (?, ?)",
    [userId, DEFAULT_LANG]
  );
  return DEFAULT_LANG;
}

async function setUserPreferredLanguage(userId, lang) {
  await db.run(
    "INSERT OR REPLACE INTO user_prefs (user_id, preferred_language) VALUES (?, ?)",
    [userId, lang]
  );
}

async function getUserPlan(userId) {
  const row = await db.get(
    "SELECT plan, messages_used, limit_per_month, renewed_at FROM plans WHERE user_id = ?",
    [userId]
  );

  if (row) return row;

  // create default if missing
  await db.run(
    "INSERT OR REPLACE INTO plans (user_id, plan, messages_used, limit_per_month) VALUES (?, ?, ?, ?)",
    [userId, DEFAULT_PLAN, 0, 500]
  );

  return {
    plan: DEFAULT_PLAN,
    messages_used: 0,
    limit_per_month: 500,
    renewed_at: new Date().toISOString(),
  };
}

async function incrementUserUsage(userId) {
  await db.run(
    "UPDATE plans SET messages_used = messages_used + 1 WHERE user_id = ?",
    [userId]
  );
}

// ---------------------------------------------------------
// Helpers: AI Language Detection + Translation
// ---------------------------------------------------------

// 1. Detect language of incoming text
async function detectLanguageOfText(text) {
  if (!text || text.trim().length === 0) return "Unknown";

  const completion = await openai.chat.completions.create({
    model: MODEL_TRANSLATE,
    messages: [
      {
        role: "system",
        content:
          "Detect the language of the user's message. Reply with only the language name (e.g. 'English', 'Punjabi', 'Russian').",
      },
      { role: "user", content: text },
    ],
  });

  const guess =
    completion?.choices?.[0]?.message?.content?.trim() || "Unknown";
  return guess;
}

// 2. Translate text to receiver's preferred language (if needed)
async function translateTextIfNeeded(originalText, fromLang, toLang) {
  if (!originalText || originalText.trim() === "") {
    return "(empty message)";
  }

  if (
    !fromLang ||
    !toLang ||
    fromLang.toLowerCase() === toLang.toLowerCase()
  ) {
    // No translation needed
    return originalText;
  }

  const translation = await openai.chat.completions.create({
    model: MODEL_TRANSLATE,
    messages: [
      {
        role: "system",
        content: `You are a live chat translator. Translate from ${fromLang} to ${toLang}. Keep tone natural, casual, and respectful.`,
      },
      { role: "user", content: originalText },
    ],
  });

  return (
    translation?.choices?.[0]?.message?.content?.trim() ||
    originalText ||
    ""
  );
}

// 3. Full message pipeline: detect, translate, save, bump usage
async function processPeerMessage({ senderId, receiverId, rawText }) {
  // a) detect sender language
  const detectedLang = await detectLanguageOfText(rawText);

  // b) lookup receiver's preferred language
  const receiverPrefLang = await getUserPreferredLanguage(receiverId);

  // c) translate to receiver's language (if needed)
  const translatedText = await translateTextIfNeeded(
    rawText,
    detectedLang,
    receiverPrefLang
  );

  // d) save to DB
  const timestamp = new Date().toISOString();

  await db.run(
    `INSERT INTO messages
      (sender_id, receiver_id, body_original, body_translated, detected_language, receiver_language, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      senderId,
      receiverId,
      rawText,
      translatedText,
      detectedLang,
      receiverPrefLang,
      timestamp,
    ]
  );

  // e) bump usage
  await getUserPlan(senderId);        // ensure row exists
  await incrementUserUsage(senderId); // increment

  return {
    body_original: rawText,
    body_translated: translatedText,
    detected_language: detectedLang,
    receiver_language: receiverPrefLang,
    created_at: timestamp,
  };
}

// ---------------------------------------------------------
// REST API ROUTES
// ---------------------------------------------------------

// Basic health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "Quantina Core",
    time: new Date().toISOString(),
  });
});

// Return last ~50 messages (for debug / bootstrapping chat history)
app.get("/api/messages", async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM messages ORDER BY id DESC LIMIT 50"
  );
  res.json(rows.reverse());
});

// Get user language pref
// GET /api/user/lang?user_id=abc
app.get("/api/user/lang", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }
  const lang = await getUserPreferredLanguage(user_id);
  res.json({ user_id, preferred_language: lang });
});

// Update user language pref
// PATCH /api/user/lang  { user_id, preferred_language }
app.patch("/api/user/lang", async (req, res) => {
  const { user_id, preferred_language } = req.body;
  if (!user_id || !preferred_language) {
    return res
      .status(400)
      .json({ error: "user_id and preferred_language required" });
  }
  await setUserPreferredLanguage(user_id, preferred_language);
  res.json({ ok: true, user_id, preferred_language });
});

// Get plan status / usage
// GET /api/user/plan?user_id=abc
app.get("/api/user/plan", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: "Missing user_id" });
  }
  const plan = await getUserPlan(user_id);
  res.json({ user_id, ...plan });
});

// Manual text-based peer message translation (REST fallback)
// POST /api/peer-message
// body: { sender_id, receiver_id, text }
app.post("/api/peer-message", async (req, res) => {
  try {
    const { sender_id, receiver_id, text } = req.body;

    if (!sender_id || !receiver_id || !text) {
      return res.status(400).json({
        success: false,
        error: "sender_id, receiver_id, and text are required",
      });
    }

    const processed = await processPeerMessage({
      senderId: sender_id,
      receiverId: receiver_id,
      rawText: text,
    });

    res.json({
      success: true,
      ...processed,
    });
  } catch (err) {
    console.error("❌ /api/peer-message error:", err.message);
    res.status(500).json({
      success: false,
      error: err.message || "Internal server error",
    });
  }
});

// ---------------------------------------------------------
// SOCKET.IO: REALTIME P2P MESSAGING
// ---------------------------------------------------------
//
// Frontend usage example:
//
// const socket = io("https://quantina-core-production.up.railway.app", {
//   auth: { token: "user123" } // <- how we identify that user
// });
//
// socket.emit("send_message", {
//   fromUserId: "user123",
//   toUserId:   "user999",
//   body:       "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਜੀ"
// });
//
// socket.on("receive_message", (msg) => {...});
//
// ---------------------------------------------------------

io.on("connection", (socket) => {
  // Identify this user
  const rawToken = socket.handshake.auth?.token;
  const userId = rawToken || "guest_" + socket.id;

  console.log(`🟢 Socket connected: ${userId}`);

  // Ensure language pref + plan rows exist
  getUserPreferredLanguage(userId).catch(() => {});
  getUserPlan(userId).catch(() => {});

  // Join a private room with their ID
  socket.join(userId);

  // Incoming messages from this user
  socket.on("send_message", async (payload) => {
    try {
      const { fromUserId, toUserId, body } = payload || {};

      if (!fromUserId || !toUserId || !body) {
        console.warn("⚠️ Invalid send_message payload:", payload);
        return;
      }

      // Translate, store, usage billing
      const processed = await processPeerMessage({
        senderId: fromUserId,
        receiverId: toUserId,
        rawText: body,
      });

      // Deliver translated message to receiver
      io.to(toUserId).emit("receive_message", {
        sender_id: fromUserId,
        body: processed.body_translated,
        created_at: processed.created_at,
        detected_language: processed.detected_language,
        receiver_language: processed.receiver_language,
        original_text: processed.body_original,
      });

      // Confirm back to sender
      socket.emit("message_sent", {
        to: toUserId,
        body_original: processed.body_original,
        body_translated: processed.body_translated,
        created_at: processed.created_at,
      });
    } catch (err) {
      console.error("❌ Error in send_message socket handler:", err.message);
      socket.emit("message_error", {
        error: err.message || "Failed to send message",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log(`🔴 Socket disconnected: ${userId}`);
  });
});

// ---------------------------------------------------------
// ROOT "/" ROUTE (simple fallback / health page for humans)
// ---------------------------------------------------------
// Note: We ALREADY mounted static above, so if /public/index.html exists
// it'll be served BEFORE this .get("/") runs. This is just a fallback.
app.get("/", (req, res) => {
  res.send("🚀 Quantina Core API & WebSocket server is running.");
});

// ---------------------------------------------------------
// START SERVER
// ---------------------------------------------------------
server.listen(PORT, () => {
  console.log(`🚀 Quantina Core live on port ${PORT}`);
  console.log(`🌐 Ready for WebSocket + REST usage`);
});
