import sqlite3 from "sqlite3";
const db = new sqlite3.Database("quantina.db");

const table = process.argv[2] || "messages";

db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, rows) => {
  if (err) return console.error("❌ DB Error:", err.message);
  console.log("\n🧱 Tables:", rows.map(r => r.name).join(", "));
  console.log(`\n📋 Previewing first 5 rows of '${table}'...\n`);

  db.all(`SELECT * FROM ${table} LIMIT 5;`, (err, data) => {
    if (err) return console.error("⚠️ Query Error:", err.message);
    console.table(data);
    db.close();
  });
});
