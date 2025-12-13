// =============================================================
//  Quantina Core Backend (Rebuilt for 2025 OpenAI SDK Standards)
// =============================================================

import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
import { execSync } from "child_process";
import OpenAI from "openai";

dotenv.config();

// =============================================================
// INTEGRATION CONTRACT (READ-ONLY)
// =============================================================
let integration = null;

try {
  const raw = fs.readFileSync("./integration.json", "utf-8");
  integration = JSON.parse(raw);

  console.log("🔗 Integration loaded:", {
    version: integration.version,
    core: integration.core,
    features: Object.keys(integration.features || {})
  });
} catch (e) {
  console.error("❌ Failed to load integration.json");
  console.error(e.message);
  process.exit(1);
}


// =============================================================
// OPENAI CLIENT  (OFFICIAL 2025 SDK) 
// =============================================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// =============================================================
// POSTGRESQL CONNECTION
// =============================================================
import pkg from "pg";
const { Pool } = pkg;

const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pg.connect()
  .then(() => console.log("🟢 [DB] PostgreSQL connected"))
  .catch(err => console.error("🔴 [DB CONNECT ERROR]:", err));


// =============================================================
// EXPRESS + SOCKET.IO SETUP
// =============================================================
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.sendStatus(200);
});


// =============================================================
// API KEY FIREWALL (UPDATED TO ALLOW SOCKET.IO + ROOT ACCESS)
// =============================================================

// Allow socket.io handshake without API key
app.use((req, res, next) => {
  if (req.path.startsWith("/socket.io/")) {
    return next();
  }
  next();
});

// Allow base URL GET request without API key
app.use((req, res, next) => {
  if (req.method === "GET" && req.path === "/") {
    return next();
  }
  next();
});

// Require API key for everything else
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const clientKey = req.headers["x-api-key"];

  if (!clientKey || clientKey !== process.env.MASTER_KEY) {
    console.log("🔴 [AUTH BLOCK] Invalid API key");
    return res.status(403).json({ error: "Invalid API Key" });
  }

  next();
});


// =============================================================
// EXPRESS MIDDLEWARE
// =============================================================
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
app.use("/langs", express.static("langs"));


// =============================================================
// USER LANGUAGE HELPERS
// =============================================================
async function getUserLang(id) {
  try {
    const r = await pg.query("SELECT preferred_lang FROM users WHERE id=$1", [id]);
    return r.rows[0]?.preferred_lang || "English";
  } catch (e) {
    console.error("DB getUserLang error:", e);
    return "English";
  }
}

async function setUserLang(id, lang) {
  try {
    await pg.query(
      `INSERT INTO users (id, preferred_lang)
       VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET preferred_lang=$2`,
      [id, lang]
    );
  } catch (e) {
    console.error("DB setUserLang error:", e);
  }
}


// =============================================================
// AUDIO TRANSCRIPTION  (OFFICIAL OPENAI SDK)
// =============================================================
async function transcribeAudio(filePath) {
  try {
    console.log("🎤 Converting to WAV:", filePath);

    const wav = filePath + ".wav";
    execSync(`ffmpeg -y -i ${filePath} -ac 1 -ar 16000 ${wav}`);

    console.log("🎤 Sending to OpenAI…");

    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(wav),
      model: "gpt-4o-mini-transcribe",
      response_format: "text"
    });

    fs.unlinkSync(filePath);
    fs.unlinkSync(wav);

    console.log("🎤 Transcription:", result);

    return result.trim();
  } catch (e) {
    console.error("❌ AUDIO ERROR:", e);
    return "";
  }
}


// =============================================================
// LANGUAGE DETECTION
// =============================================================
async function detectLanguage(text) {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Detect the language. Return ONLY the language name." },
        { role: "user", content: text }
      ]
    });

    return r.choices[0].message.content.trim();
  } catch (e) {
    console.error("Lang detect error:", e);
    return "Unknown";
  }
}


// =============================================================
// TRANSLATION
// =============================================================
async function translateText(text, targetLang) {
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate ONLY into ${targetLang}.`
        },
        { role: "user", content: text }
      ]
    });

    return r.choices[0].message.content.trim();
  } catch (e) {
    console.error("Translate error:", e);
    return text;
  }
}


// =============================================================
// FILE UPLOAD HANDLER
// =============================================================
const upload = multer({ dest: "uploads/" });


// =============================================================
// OCR + TRANSLATION (OpenAI Responses API)
// =============================================================
app.post("/api/scan-translate", async (req, res) => {
	
	if (!integration.features?.scan_ocr?.enabled) {
  return res.status(403).json({
    success: false,
    error: "scan_ocr feature is disabled by core policy"
  });
}

  try {
    const { image_base64, target_language } = req.body;

    console.log("📸 OCR request received");

    // 1️⃣ OCR EXTRACTION
    const ocr = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extract all visible text from the image. Return ONLY the text."
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${image_base64}`
            }
          ]
        }
      ]
    });

    const raw = ocr.output_text?.trim() || "";
    if (!raw) {
      return res.json({
        success: false,
        message: "No text detected."
      });
    }

    // 2️⃣ TRANSLATION
    const translated = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Translate the following into ${target_language}:\n\n${raw}`
            }
          ]
        }
      ]
    });

    res.json({
      success: true,
      raw_text: raw,
      translated_text: translated.output_text || ""
    });

  } catch (e) {
    console.error("OCR error:", e);
    res.status(500).json({ error: "OCR failed", details: e.message });
  }
});


// =============================================================
// MAIN MESSAGE PIPELINE
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
	
	// =============================================================
// PEER MESSAGE MODE GATING (VOICE ONLY)
// =============================================================
if (req.body?.mode === "voice") {
  const allowedModes = integration.features?.peer_messaging?.modes || [];

  if (!allowedModes.includes("voice")) {
    return res.status(403).json({
      success: false,
      error: "Voice messaging is disabled by core policy"
    });
  }
}

  try {
    const { sender_id, receiver_id, mode, text, body } = req.body;

    let message = body || text || "";

    if (mode === "voice" && req.file) {
      console.log("🎤 Processing voice message…");
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

    await pg.query(
      "INSERT INTO messages (sender_id, receiver_id, body) VALUES ($1,$2,$3)",
      [sender_id, receiver_id, message]
    );

    const sockets = userSockets.get(receiver_id);
    if (sockets) {
      sockets.forEach(id => {
        io.to(id).emit("p2p_incoming", {
          fromUserId: sender_id,
          toUserId: receiver_id,
          audio: mode === "voice",
          body_raw: message,
          body_translated: translated,
          source_lang: senderLang,
          target_lang: receiverLang,
          ts: Date.now()
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

  } catch (e) {
    console.error("Peer message error:", e);
    res.status(500).json({ error: "Message pipeline failed" });
  }
});


// =============================================================
// USER LIST
// =============================================================
app.get("/api/users", async (req, res) => {
  const r = await pg.query("SELECT * FROM users");
  res.json(r.rows);
});


// =============================================================
// SOCKET ENGINE
// =============================================================
const userSockets = new Map();

io.use((socket, next) => {
  const uid = socket.handshake.auth?.userId;
  if (!uid) return next(new Error("No userId"));
  socket.userId = uid;
  next();
});

io.on("connection", socket => {
  const uid = socket.userId;

  if (!userSockets.has(uid)) userSockets.set(uid, new Set());
  userSockets.get(uid).add(socket.id);

  socket.on("disconnect", () => {
    const set = userSockets.get(uid);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) userSockets.delete(uid);
  });

  socket.on("p2p_outgoing", msg => {

  // ===============================
  // REALTIME TRANSPORT POLICY GATE
  // ===============================
  if (!integration.features?.realtime_transport?.enabled) {
    console.log("🚫 Realtime transport blocked by integration policy");
    return;
  }

  const receivers = userSockets.get(msg.toUserId);
  if (!receivers) return;

  receivers.forEach(id => {
    io.to(id).emit("p2p_incoming", {
      ...msg,
      ts: Date.now()
    });
  });
});
});



// =============================================================
// START SERVER
// =============================================================
server.listen(PORT, () => {
  console.log(`🚀 Quantina Core running on port ${PORT}`);
});

