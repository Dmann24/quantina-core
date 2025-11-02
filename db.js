// =============================================================
// Quantina Core - SQLite Database Setup (Patched for body_original)
// =============================================================

import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

// Detect environment path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file location (persistent in Railway’s /data or local directory)
const dbPath = path.join(__dirname, "quantina.db");

// Initialize SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Failed to connect to SQLite:", err.message);
  } else {
    console.log("✅ SQLite connected at:", dbPath);
  }
});

// =============================================================
// Create table (if not exists) — baseline schema
// =============================================================
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    text TEXT,
    mode TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error("❌ Error creating messages table:", err.message);
  } else {
    console.log("✅ messages table verified.");
  }
});

// =============================================================
// Auto-migrate: ensure new column exists (body_original)
// =============================================================
db.run(`ALTER TABLE messages ADD COLUMN body_original TEXT;`, (err) => {
  if (err && !err.message.includes("duplicate column name")) {
    console.warn("⚠️ Migration skipped or failed:", err.message);
  } else {
    console.log("✅ Column body_original verified or added.");
  }
});

// =============================================================
// Export the DB connection
// =============================================================
export default db;
