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
import { open } from "sqlite";
import sqlite3 from "sqlite3";

dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 8080;
// ---------------------------------------------------
// Allow OPTIONS requests (Fix 403 preflight)
// ---------------------------------------------------
app.options("*", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
    return res.sendStatus(200);
});


// =============================================================
// 🔐 GLOBAL API KEY FIREWALL (Protects ALL ROUTES)
// =============================================================
app.use((req, res, next) => {
  const clientKey = req.headers["x-api-key"];

  if (!clientKey || clientKey !== process.env.MASTER_KEY) {
    return res.status(403).json({ error: "Forbidden: Invalid API Key" });
  }

  next();
});
// =============================================================
// 📁 Ensure data folder exists
// =============================================================
if (!fs.existsSync("data")) fs.mkdirSync("data");

let db;

// =============================================================
// 🧠 SQLite – single, clean initialization
// =============================================================
(async () => {
  db = await open({
    filename: "./data/quantina.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      preferred_lang TEXT
    )
  `);

  console.log("✅ SQLite tables are ready");
})();

// =============================================================
// 🧠 User language helpers (SQLite only)
// =============================================================
async function getUserLang(id) {
  try {
    const row = await db.get(
      "SELECT preferred_lang FROM users WHERE id = ?",
      [id]
    );
    return row?.preferred_lang || "English";
  } catch (err) {
    console.error("⚠️ getUserLang error:", err);
    return "English";
  }
}

async function setUserLang(id, lang) {
  try {
    await db.run(
      "INSERT OR REPLACE INTO users (id, preferred_lang) VALUES (?, ?)",
      [id, lang]
    );
  } catch (err) {
    console.error("⚠️ setUserLang error:", err);
  }
}

// =============================================================
// 🛡️ CORS + body parsing
// =============================================================
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/langs", express.static("langs"));

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

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: formData,
      }
    );

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
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a language detector. Identify the language name only (e.g., English, French, Punjabi).",
            },
            { role: "user", content: text },
          ],
        }),
      }
    );

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
    if (!text || text.trim().length === 0) return text;

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
                You are QUANTINA TRANSLATOR.
                Your ONLY job is to translate text from the input language into ${targetLang}.
                
                STRICT RULES:
                - DO NOT answer questions.
                - DO NOT generate code.
                - DO NOT explain anything.
                - DO NOT be conversational.
                - DO NOT provide examples.
                - ONLY return the translated text.
                - If the text is already in the target language, return it EXACTLY as-is.
              `,
            },
            { role: "user", content: text },
          ],
        }),
      }
    );

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
// 🧠 Main Endpoint: /api/peer-message  (HYBRID: HTTP in → Socket out)
// =============================================================
app.post(
  "/api/peer-message",
  upload.single("audio"),
  async (req, res) => {
    try {
      // Support both JSON (text) and multipart (voice)
      const { sender_id, receiver_id, text, body, mode } = req.body;

      // Prefer "body" (what your app/peer sends), fallback to "text"
      let message = body || text || "";

      if (!sender_id || !receiver_id) {
        return res.status(400).json({
          success: false,
          error: "sender_id and receiver_id are required",
        });
      }

      // 🎙️ Voice transcription
      if (mode === "voice" && req.file) {
        console.log(`🎙️ Voice received from ${sender_id}: ${req.file.path}`);
        message = await transcribeAudio(req.file.path);
      }

      // If still empty, don't try to be fancy
      if (!message || !message.trim()) {
        console.warn("⚠️ Empty message payload, skipping translation");
        return res.json({
          success: true,
          sender_language: "Unknown",
          receiver_language: "Unknown",
          original: "",
          translated: "",
        });
      }

      // 🌍 Language detection & translation
      const senderLang = await detectLanguage(message);
      const receiverLang = await getUserLang(receiver_id);
      const translated = await translateText(message, receiverLang);

      await setUserLang(sender_id, senderLang);

      console.log(`🟢 Processed (${mode || "text"}) ${sender_id} → ${receiver_id}`);

      // 🔥 REAL-TIME DELIVERY over socket
      const targetSocket = [...io.sockets.sockets.values()].find(
        (s) => s.handshake.auth?.token === receiver_id
      );

      if (targetSocket) {
        console.log("📨 Delivering message via socket:", receiver_id);

        targetSocket.emit("p2p_incoming", {
          fromUserId: sender_id,
          toUserId: receiver_id,
          body_raw: message,
          body_translated: translated,
          source_lang: senderLang,
          target_lang: receiverLang,
        });
      } else {
        console.log("⚠️ Receiver is not live:", receiver_id);
      }

      // Response back to sender (for UI if needed)
      res.json({
        success: true,
        sender_language: senderLang,
        receiver_language: receiverLang,
        original: message,
        translated,
      });
    } catch (err) {
      console.error("❌ /api/peer-message failed:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// =============================================================
// 🌍 Utility Routes
// =============================================================
app.get("/api/users", async (req, res) => {
  try {
    const rows = await db.all("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/users error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Quantina Core v4.0</title></head>
      <body style="font-family:Arial;text-align:center;margin-top:120px;">
        <h1>🤖 Quantina Core AI Translation Relay v4.0</h1>
        <p>Status: <b>Online</b></p>
        <p>Persistence: SQLite Database</p>
        <p>POST endpoint: <code>/api/peer-message</code></p>
        <p>GET users: <code>/api/users</code></p>
      </body>
    </html>
  `);
});

// =============================================================
// 🌡️ Health check
// =============================================================
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Quantina Core is alive" });
});
// 🩺 Health check
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Quantina Core is alive" });
});




// =============================================================
// ⚡ Socket Layer – only for delivery + presence
// =============================================================
io.on("connection", (socket) => {
  console.log(
    "🟢 Socket connected:",
    socket.id,
    "AUTH:",
    socket.handshake.auth
  );

  socket.on("disconnect", () => {
    console.log(`🔴 Socket disconnected: ${socket.id}`);
  });
});

// =============================================================
// 🚀 Start Express + Socket Server
// =============================================================
server.listen(PORT, () => {
  console.log(`✅ Quantina Core Live Socket running on port ${PORT}`);
});

