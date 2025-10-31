import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

console.log("✅ Testing .env loading...");
console.log("Resolved path:", path.resolve(__dirname, ".env"));
console.log("API KEY VALUE:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 10) + "..." : "❌ Not found");
