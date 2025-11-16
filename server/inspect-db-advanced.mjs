import sqlite3 from "sqlite3";
import inquirer from "inquirer";
import chalk from "chalk";
import Table from "cli-table3";

const db = new sqlite3.Database("quantina.db");

function getTables() {
  return new Promise((resolve, reject) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.name));
    });
  });
}

function getCount(table) {
  return new Promise(resolve => {
    db.get(`SELECT COUNT(*) AS count FROM ${table};`, (err, row) => {
      resolve(err ? 0 : row.count);
    });
  });
}

async function main() {
  console.log(chalk.cyan("\n🔍 Scanning database tables...\n"));
  const tables = await getTables();

  if (tables.length === 0) {
    console.log(chalk.red("❌ No tables found in quantina.db"));
    db.close();
    return;
  }

  // Count rows in each table
  const tableCounts = {};
  for (const t of tables) {
    tableCounts[t] = await getCount(t);
  }

  // Display summary
  console.log(chalk.bold("🧱 Table Summary:\n"));
  tables.forEach(t => {
    const count = tableCounts[t];
    const color = count > 0 ? chalk.green : chalk.yellow;
    console.log(`• ${chalk.white(t)} → ${color(`${count} row${count === 1 ? "" : "s"}`)}`);
  });

  // Ask user which table to inspect
  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: chalk.cyan("\n📋 Select a table to preview:"),
      choices: tables
    }
  ]);

  console.log(chalk.magenta(`\nPreviewing first 5 rows of '${selected}'...\n`));

  db.all(`SELECT * FROM ${selected} LIMIT 5;`, (err, rows) => {
    if (err) {
      console.error(chalk.red(`⚠️ Error reading ${selected}: ${err.message}`));
    } else if (!rows.length) {
      console.log(chalk.yellow(`(empty)`));
    } else {
      const headers = Object.keys(rows[0]);
      const table = new Table({ head: headers.map(h => chalk.blueBright(h)) });
      rows.forEach(r => table.push(headers.map(h => r[h])));
      console.log(table.toString());
    }
    db.close();
  });
}

main().catch(err => console.error(chalk.red("❌ Unexpected error:"), err));
