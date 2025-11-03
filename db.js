// =============================================================
// Quantina Core - SQLite Fix (For body_original Column)
// =============================================================

import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "quantina.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("❌ SQLite connect failed:", err.message);
  else console.log("✅ SQLite connected:", dbPath);
});
console.log("🧭 Running on Railway:", process.env.RAILWAY_ENVIRONMENT || "local");
console.log("📁 Using database path:", dbPath);

// 1️⃣ Ensure base table exists
db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    text TEXT,
    mode TEXT,
    body_original TEXT,
timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	
  )
`);
db.all("PRAGMA table_info(messages);", (err, cols) => {
  if (err) console.error(err);
  else console.log("📋 Columns in messages:", cols.map(c => c.name));
});


// 2️⃣ Check if the body_original column exists
db.get(
  "PRAGMA table_info(messages);",
  (err, row) => {
    if (err) {
      console.error("❌ Schema check failed:", err.message);
      return;
    }

    db.all("PRAGMA table_info(messages);", (err, columns) => {
      if (err) {
        console.error("❌ Could not fetch columns:", err.message);
        return;
      }

      const hasColumn = columns.some((c) => c.name === "body_original");

      if (!hasColumn) {
        console.log("⚙️ Adding missing column: body_original...");
        db.run(`ALTER TABLE messages ADD COLUMN body_original TEXT;`, (err2) => {
          if (err2) console.error("❌ Migration failed:", err2.message);
          else console.log("✅ Column body_original added successfully.");
        });
      } else {
        console.log("✅ Column body_original already exists.");
      }
    });
  }
);

// Export
export default db;
