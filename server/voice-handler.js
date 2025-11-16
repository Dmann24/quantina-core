// ===============================================
// Quantina Voice Handler (v6.1)
// 🎙️ Voice-to-Text + 🌐 Auto Language Detection + Bi-Directional Translation
// ===============================================

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";
import { execSync } from "child_process";

dotenv.config();
const router = express.Router();

// -----------------------------------------------
// 🧠 Lazy initialize OpenAI
// -----------------------------------------------
let openai;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ Missing OPENAI_API_KEY in .env!");
      throw new Error("Missing OpenAI API key");
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// -----------------------------------------------
// ⚙️ Multer setup for uploads
// -----------------------------------------------
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/ogg",
      "audio/m4a",
      "audio/x-m4a",
      "audio/webm",
    ];
    if (!allowed.includes(file.mimetype)) {
      console.warn("⚠️ Rejected unsupported file:", file.mimetype);
      return cb(new Error("400 Unsupported file format"));
    }
    cb(null, true);
  },
});

// -----------------------------------------------
// 🔍 Health check route
// -----------------------------------------------
router.get("/peer-message", (req, res) => {
  res.json({ ok: true, msg: "Quantina peer-message route active ✅" });
});

// -----------------------------------------------
// 🎧 Voice-to-Text + Translation Route
// -----------------------------------------------
router.post("/peer-message", upload.single("audio"), async (req, res) => {
  console.log("🎧 /api/peer-message received request");

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No audio file uploaded." });
    }

    const openai = getOpenAI();
    const filePath = req.file.path;
    let inputFilePath = filePath;
    const ext = path.extname(filePath).toLowerCase();

    // Optional conversion for unsupported formats
    const supported = [".mp3", ".wav", ".ogg", ".m4a", ".webm"];
    if (!supported.includes(ext)) {
      console.log(`⚙️ Converting ${ext} to .wav via ffmpeg...`);
      const wavPath = filePath.replace(ext, ".wav");
      try {
        execSync(`ffmpeg -y -i "${filePath}" -ar 44100 -ac 2 "${wavPath}"`);
        inputFilePath = wavPath;
      } catch (err) {
        console.error("❌ FFmpeg conversion failed:", err.message);
        return res.status(400).json({ success: false, error: "FFmpeg conversion failed" });
      }
    }

    // 🧠 Step 1: Transcribe
    console.log("🧠 Transcribing with Whisper...");
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(inputFilePath),
      model: "gpt-4o-mini-transcribe",
    });

    const originalText = transcription.text?.trim() || "(no speech detected)";
    console.log("✅ Transcription:", originalText);

    // 🌍 Step 2: Detect language
    let detectedLang = transcription.language || "auto";
    if (detectedLang === "auto") {
      const detectResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Detect the language of this text. Respond with only the language name (e.g. Punjabi, English, Hindi).",
          },
          { role: "user", content: originalText },
        ],
      });
      detectedLang = detectResp.choices[0]?.message?.content?.trim() || "Unknown";
      console.log("🧭 Detected language:", detectedLang);
    }

    // 🌐 Step 3: Translate to receiver’s preferred language
    const receiverLang = req.body.receiver_lang || "English";
    let translatedText = originalText;

    if (detectedLang.toLowerCase() !== receiverLang.toLowerCase()) {
      console.log(`🌐 Translating from ${detectedLang} → ${receiverLang}`);
      const translationResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Translate from ${detectedLang} to ${receiverLang}. Keep tone natural and conversational.`,
          },
          { role: "user", content: originalText },
        ],
      });
      translatedText =
        translationResp.choices[0]?.message?.content?.trim() || "(translation unavailable)";
    }

    console.log("✅ Translation:", translatedText);

    // 🧹 Step 4: Clean up temp files
    fs.unlink(filePath, () => {});
    if (inputFilePath !== filePath) fs.unlink(inputFilePath, () => {});

    // ✅ Step 5: Return result
    return res.json({
      success: true,
      original_text: originalText,
      translated_text: translatedText,
      detected_language: detectedLang,
      receiver_language: receiverLang,
    });
  } catch (error) {
    console.error("❌ Peer Message Error:", error.message);
    const status = error.message.startsWith("400") ? 400 : 500;
    res.status(status).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
});

console.log("✅ Voice Handler v6.1 — Transcribe + Translate — ready!");
export default router;
