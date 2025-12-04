import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";
import { execSync } from "child_process";

import pkg from "pg";
const { Pool } = pkg;

dotenv.config();

// =============================
// PostgreSQL Connection Pool
// =============================
const pg = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  port: process.env.PGPORT,
  ssl: { rejectUnauthorized: false }
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;

// =============================================================
// Allow OPTIONS
// =============================================================
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return res.sendStatus(200);
});

// =============================================================
// API-KEY FIREWALL
// =============================================================
app.use((req, res, next) => {
  const clientKey = req.headers["x-api-key"];
  if (!clientKey || clientKey !== process.env.MASTER_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }
  next();
});

// =============================================================
// User Language Helpers (Postgres Only)
// =============================================================
async function getUserLang(id) {
  try {
    const result = await pg.query(
      "SELECT preferred_lang FROM users WHERE id=$1",
      [id]
    );
    return result.rows[0]?.preferred_lang || "English";
  } catch (err) {
    console.error("⚠️ PostgreSQL getUserLang error:", err);
    return "English";
  }
}

async function setUserLang(id, lang) {
  try {
    await pg.query(
      `INSERT INTO users (id, preferred_lang)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET preferred_lang = EXCLUDED.preferred_lang`,
      [id, lang]
    );
  } catch (err) {
    console.error("❌ PostgreSQL setUserLang error:", err);
  }
}

// =============================================================
// Middleware
// =============================================================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"]
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/langs", express.static("langs"));

// =============================================================
// Transcription Function
// =============================================================
async function transcribeAudio(filePath) {
  try {
    const tempWav = `${filePath}.wav`;
    execSync(`ffmpeg -y -i ${filePath} -ac 1 -ar 16000 ${tempWav}`);

    const formData = new FormData();
    formData.append("file", fs.createReadStream(tempWav));
    formData.append("model", "gpt-4o-mini-transcribe");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: formData
      }
    );

    const data = await response.json();

    fs.unlinkSync(filePath);
    fs.unlinkSync(tempWav);

    return data.text?.trim() || "";
  } catch (err) {
    console.error("❌ Transcription error:", err);
    return "";
  }
}

// =============================================================
// Language Detection
// =============================================================
async function detectLanguage(text) {
  if (!text.trim()) return "Unknown";

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
              "You are a language detector. Return the language name only."
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
// Translation
// =============================================================
async function translateText(text, targetLang = "English") {
  try {
    if (!text.trim()) return text;

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
            content: `
              You are QUANTINA TRANSLATOR.
              ONLY translate to ${targetLang}.
              No explanations. No examples. Return translation only.
            `
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
// File Upload Handler
// =============================================================
const upload = multer({ dest: "uploads/" });

// =============================================================
// Main /api/peer-message Endpoint
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  try {
    const { sender_id, receiver_id, text, body, mode } = req.body;
    let message = body || text || "";

    if (!sender_id || !receiver_id) {
      return res.status(400).json({
        success: false,
        error: "sender_id and receiver_id are required"
      });
    }

    if (mode === "voice" && req.file) {
      message = await transcribeAudio(req.file.path);
    }

    if (!message.trim()) {
      return res.json({
        success: true,
        sender_language: "Unknown",
        receiver_language: "Unknown",
        original: "",
        translated: ""
      });
    }

    const senderLang = await detectLanguage(message);
    const receiverLang = await getUserLang(receiver_id);
    const translated = await translateText(message, receiverLang);

    await setUserLang(sender_id, senderLang);

    // Store original message in Postgres
    try {
      await pg.query(
        `INSERT INTO messages (sender_id, receiver_id, body)
         VALUES ($1, $2, $3)`,
        [sender_id, receiver_id, message]
      );
    } catch (err) {
      console.error("❌ Postgres insert error:", err);
    }

    // Real-time socket delivery
    const receivers = userSockets.get(receiver_id);
    if (receivers) {
      receivers.forEach((sockId) => {
        io.to(sockId).emit("p2p_incoming", {
          fromUserId: sender_id,
          toUserId: receiver_id,
          audio: mode === "voice",
          body_raw: message,
          body_translated: translated,
          source_lang: senderLang,
          target_lang: receiverLang
        });
      });
    }

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
// GET /api/users (Postgres Version)
// =============================================================
app.get("/api/users", async (req, res) => {
  try {
    const result = await pg.query("SELECT * FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ /api/users error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// Health Check
// =============================================================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Quantina Core is alive" });
});

// =============================================================
// Socket Routing Engine
// =============================================================
const userSockets = new Map();

io.use((socket, next) => {
  const userId = socket.handshake.auth?.userId;
  if (!userId) return next(new Error("Missing userId"));
  socket.userId = userId;
  next();
});

io.on("connection", (socket) => {
  const userId = socket.userId;

  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  socket.on("p2p_outgoing", (msg) => {
    const { fromUserId, toUserId, body } = msg;

    const receivers = userSockets.get(toUserId);
    if (!receivers) return;

    receivers.forEach((sockId) => {
      io.to(sockId).emit("p2p_incoming", {
        fromUserId,
        toUserId,
        body,
        timestamp: Date.now()
      });
    });
  });

  socket.on("disconnect", () => {
    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) userSockets.delete(userId);
    }
  });
});

// =============================================================
// Start Server
// =============================================================
server.listen(PORT, () =>
  console.log(`✅ Quantina Core running on port ${PORT}`)
);
