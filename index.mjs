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

dotenv.config();

// =============================================================
// PostgreSQL CONNECTION
// =============================================================
import pkg from "pg";
const { Pool } = pkg;

const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pg.connect()
  .then(() => console.log("🟢 [DB] PostgreSQL connected successfully"))
  .catch(err => console.error("🔴 [DB ERROR] Failed to connect:", err));


// =============================================================
// EXPRESS + SOCKET.IO SETUP
// =============================================================
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;

// Allow preflight
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return res.sendStatus(200);
});

// =============================================================
// API KEY FIREWALL
// =============================================================
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return next();

  const clientKey = req.headers["x-api-key"];
  if (!clientKey || clientKey !== process.env.MASTER_KEY) {
    console.log("🔴 [AUTH] Blocked request - invalid API KEY");
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }

  next();
});


// =============================================================
// USER LANGUAGE HELPERS
// =============================================================
async function getUserLang(id) {
  try {
    const result = await pg.query(
      "SELECT preferred_lang FROM users WHERE id=$1",
      [id]
    );

    console.log("🟣 [DB] getUserLang:", id, "=>", result.rows[0]?.preferred_lang);

    return result.rows[0]?.preferred_lang || "English";
  } catch (err) {
    console.error("🔴 [DB ERROR] getUserLang:", err);
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

    console.log("🟣 [DB] setUserLang:", id, "=>", lang);

  } catch (err) {
    console.error("🔴 [DB ERROR] setUserLang:", err);
  }
}

// =============================================================
// MIDDLEWARE
// =============================================================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"]
  })
);

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/langs", express.static("langs"));


// =============================================================
// AUDIO TRANSCRIPTION
// =============================================================
async function transcribeAudio(filePath) {
  try {
    console.log("🎤 [AUDIO] Transcribing:", filePath);

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

    console.log("🎤 [AUDIO] Transcribed text:", data.text);

    return data.text?.trim() || "";
  } catch (err) {
    console.error("🔴 [AUDIO ERROR] transcribeAudio:", err);
    return "";
  }
}


// =============================================================
// LANGUAGE DETECTION
// =============================================================
async function detectLanguage(text) {
  try {
    console.log("🌐 [LANG DETECT] Input:", text);

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Return language name only." },
            { role: "user", content: text }
          ]
        })
      }
    );

    const data = await response.json();
    const lang = data?.choices?.[0]?.message?.content?.trim() || "Unknown";

    console.log("🌐 [LANG DETECTED] =>", lang);
    return lang;
  } catch (err) {
    console.error("🔴 [ERROR] detectLanguage:", err);
    return "Unknown";
  }
}


// =============================================================
// TRANSLATION
// =============================================================
async function translateText(text, targetLang) {
  try {
    console.log("🔵 [TRANSLATE] =>", targetLang, " | TEXT:", text);

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
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
              content: `Translate ONLY into ${targetLang}.`
            },
            { role: "user", content: text }
          ]
        })
      }
    );

    const data = await response.json();
    const translated = data?.choices?.[0]?.message?.content?.trim() || text;

    console.log("🔵 [TRANSLATED] =>", translated);

    return translated;
  } catch (err) {
    console.error("🔴 [ERROR] translateText:", err);
    return text;
  }
}


// =============================================================
// FILE UPLOAD
// =============================================================
const upload = multer({ dest: "uploads/" });
// =============================================================
// LIVE CAMERA SCAN → OCR → TRANSLATION
// =============================================================
app.post("/api/scan-translate", async (req, res) => {
  try {
    const { image_base64, target_language } = req.body;
    console.log("🟨 [SCAN] Received image for OCR + translation");

    // ---------------------------------------------------------
    // 1️⃣ OCR USING GPT-4O  (Vision-enabled)
    // ---------------------------------------------------------
    const ocrResponse = await fetch("https://api.openai.com/v1/responses", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4.1",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: `data:image/jpeg;base64,${image_base64}`
          },
          {
            type: "text",
            text: "Extract ALL visible text. Return ONLY raw text. Do NOT translate."
          }
        ]
      }
    ]
  })
});


    const ocrJSON = await ocrResponse.json();

    // Correct 2025 OCR output path
    const ocrRaw = ocrJSON?.output_text ?? "";
    console.log("📄 [VISION RAW MODEL OUTPUT] =>", ocrRaw);

    const rawText = (ocrRaw || "").trim();
    console.log("🟦 [VISION OCR RESULT] =>", rawText);

    if (!rawText || rawText.length < 2) {
      return res.json({
        success: false,
        raw_text: "",
        translated_text: "",
        message: "No text detected."
      });
    }

    // ---------------------------------------------------------
    // 2️⃣ TRANSLATE USING GPT-4O-MINI
    // ---------------------------------------------------------
    const translateResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
Translate the following text into ${target_language}.
Return only the translated text. No extra words.

Text:
${rawText}
`
              }
            ]
          }
        ]
      })
    });

    const translateJSON = await translateResponse.json();
    const translatedText = translateJSON?.output_text ?? "";
    console.log("🌍 [VISION TRANSLATED RESULT] =>", translatedText);

    // ---------------------------------------------------------
    // 3️⃣ SEND RESPONSE
    // ---------------------------------------------------------
    return res.json({
      success: true,
      raw_text: rawText,
      translated_text: translatedText
    });

  } catch (err) {
    console.error("🔴 [VISION ERROR] scan-translate:", err);
    res.status(500).json({ error: "Vision OCR/translation failed" });
  }
});





// =============================================================
// MAIN API ENDPOINT
// =============================================================
app.post("/api/peer-message", upload.single("audio"), async (req, res) => {
  console.log("📩 [API] Incoming peer-message:", {
    sender: req.body.sender_id,
    receiver: req.body.receiver_id,
    mode: req.body.mode,
    ts: new Date().toISOString()
  });

  try {
    const { sender_id, receiver_id, text, body, mode } = req.body;
    let message = body || text || "";

    if (!sender_id || !receiver_id) {
      console.log("🔴 [API ERROR] Missing sender or receiver");
      return res.status(400).json({ error: "sender_id and receiver_id required" });
    }

    if (mode === "voice" && req.file) {
      message = await transcribeAudio(req.file.path);
    }

    if (!message.trim()) {
      console.log("⚪ [API] Empty message");
      return res.json({
        success: true,
        sender_language: "Unknown",
        receiver_language: "Unknown",
        original: "",
        translated: ""
      });
    }

    // Language processing
    const senderLang = await detectLanguage(message);
    const receiverLang = await getUserLang(receiver_id);
    const translated = await translateText(message, receiverLang);

    await setUserLang(sender_id, senderLang);

    // Store in DB
    try {
      await pg.query(
        `INSERT INTO messages (sender_id, receiver_id, body)
         VALUES ($1, $2, $3)`,
        [sender_id, receiver_id, message]
      );
      console.log("💾 [DB] Message saved");
    } catch (err) {
      console.error("🔴 [DB ERROR] Insert message:", err);
    }

    // Real-time socket delivery
    const receivers = userSockets.get(receiver_id);
    if (receivers) {
      console.log("📡 [SOCKET] Delivering to:", receivers);

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

    console.log("✅ [API] Message processed");

    res.json({
      success: true,
      sender_language: senderLang,
      receiver_language: receiverLang,
      original: message,
      translated
    });

  } catch (err) {
    console.error("🔴 [API ERROR] /api/peer-message:", err);
    res.status(500).json({ error: err.message });
  }
});


// =============================================================
// USER LIST
// =============================================================
app.get("/api/users", async (req, res) => {
  console.log("📋 [API] /api/users requested");

  try {
    const result = await pg.query("SELECT * FROM users");
    res.json(result.rows);
  } catch (err) {
    console.error("🔴 [API ERROR] /api/users:", err);
    res.status(500).json({ error: err.message });
  }
});


// =============================================================
// SOCKET ENGINE
// =============================================================
const userSockets = new Map();

io.use((socket, next) => {
  const userId = socket.handshake.auth?.userId;

  if (!userId) {
    console.log("🔴 [SOCKET] Missing userId, rejecting connection");
    return next(new Error("Missing userId"));
  }

  socket.userId = userId;
  next();
});

io.on("connection", (socket) => {
  const userId = socket.userId;

  console.log(`🔌 [SOCKET] CONNECTED => userId=${userId}, socket=${socket.id}`);

  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  socket.on("p2p_outgoing", (msg) => {
    console.log("📡 [SOCKET OUT]", msg);

    const receivers = userSockets.get(msg.toUserId);
    if (!receivers) {
      console.log("⚪ [SOCKET] No receivers online");
      return;
    }

    receivers.forEach((sockId) => {
      io.to(sockId).emit("p2p_incoming", {
        ...msg,
        timestamp: Date.now()
      });
    });

    console.log("📨 [SOCKET] Delivered to:", [...receivers]);
  });

  socket.on("disconnect", () => {
    console.log(`🔌 [SOCKET] DISCONNECTED => socket=${socket.id}`);

    const set = userSockets.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) userSockets.delete(userId);
    }
  });
});


// =============================================================
// START SERVER
// =============================================================
server.listen(PORT, () =>
  console.log(`🚀 Quantina Core running on port ${PORT}`)
);
