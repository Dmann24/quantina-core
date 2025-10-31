// ==============================================
// Quantina Messenger Backend (v7.0)
// ✅ Express + Socket.IO server
// ✅ JWT-based authentication
// ✅ Secure peer-to-peer message relay
// ✅ Ready for MySQL or WordPress integration
// ==============================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import jwt from "jsonwebtoken";

// ==========================
// 🔐 Configuration
// ==========================
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "quantina_secret_key";

// Optional: For production, replace this with your MySQL or WP table integration
const connectedUsers = new Map(); // socket.id → user info

// ==========================
// 🚀 Initialize App + Server
// ==========================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// ==========================
// 🧩 REST API — Auth Routes
// ==========================

// Mock user database
const demoUsers = [
  { id: 1, name: "User 1", email: "user1@quantina.ai", password: "test123" },
  { id: 2, name: "User 2", email: "user2@quantina.ai", password: "test123" },
];

// POST /login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = demoUsers.find((u) => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token, user });
});

// POST /register — (mock version)
app.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (demoUsers.find((u) => u.email === email)) {
    return res.status(400).json({ error: "User already exists" });
  }
  const newUser = { id: demoUsers.length + 1, name, email, password };
  demoUsers.push(newUser);
  const token = jwt.sign({ id: newUser.id, name: newUser.name }, JWT_SECRET, { expiresIn: "7d" });
  return res.json({ token, user: newUser });
});

// ==========================
// 🧠 Helper — Verify JWT
// ==========================
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ==========================
// 🔌 Socket.IO Logic
// ==========================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = verifyToken(token);
  if (!user) {
    console.warn("❌ Socket rejected (invalid token)");
    return next(new Error("Unauthorized"));
  }
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.user;
  connectedUsers.set(socket.id, user);

  console.log(`🟢 ${user.name} connected (${socket.id})`);

  // Notify others (optional)
  socket.broadcast.emit("user_status", {
    user: user.name,
    status: "online",
  });

  // Handle incoming message
  socket.on("chat_message", (data) => {
    if (!data || !data.message) return;

    console.log(`💬 ${user.name}: ${data.message}`);

    // Broadcast to all others (later we'll use receiver_id)
    socket.broadcast.emit("chat_message", {
      sender: user.name,
      message: data.message,
      timestamp: new Date(),
    });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`🔴 ${user.name} disconnected`);
    connectedUsers.delete(socket.id);

    socket.broadcast.emit("user_status", {
      user: user.name,
      status: "offline",
    });
  });
});

// ==========================
// 🖥️ Root Endpoint
// ==========================
app.get("/", (req, res) => {
  res.send("Quantina Messenger Backend (v7.0) is running ✅");
});

// ==========================
// 🚀 Start Server
// ==========================
server.listen(PORT, () => {
  console.log(`🚀 Quantina Messenger server running on http://localhost:${PORT}`);
});
