// -----------------------------------------------------
// Firebase Initialization (Quantina Chat Authentication)
// (Using compat builds – no ES module imports)
// -----------------------------------------------------
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyCL8yvArEFAJU35xx3HQ5ASzTphrQrWERU",
    authDomain: "quantina-chat.firebaseapp.com",
    projectId: "quantina-chat",
    storageBucket: "quantina-chat.firebasestorage.app",
    messagingSenderId: "385432861860",
    appId: "1:138543261860:web:88f756bc0887ed5083a31"
  };

  if (window.firebase) {
    try {
      // Initialize app once
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      const auth = firebase.auth ? firebase.auth() : null;
      window.quantinaAuth = auth;
      console.log("✅ Firebase auth initialized for Quantina Chat", auth);
    } catch (err) {
      console.error("❌ Firebase init error in Quantina Chat:", err);
    }
  } else {
    console.warn("⚠️ Firebase not loaded – quantinaAuth is unavailable.");
  }
})();


/* =========================================================
   Quantina Chat Widget (v5.8.3 Stable)
   ---------------------------------------------------------
   ✅ Real-time peer-to-peer via Socket.IO
   ✅ Full REST fallback to /api/peer-message
   ✅ Mic + File + Clear + Date working
   ✅ Auto socket reconnect + message timestamps
   Backend:
   https://quantina-core-production.up.railway.app
   ========================================================= */

(function () {
  console.log("🚀 Quantina Chat Widget Loaded v5.8.3");

  // ====================================================
  // 🌐 Load Socket.IO Client Script + Initialize Socket
  // ====================================================
  let socket = null;

  function initSocket() {
    if (typeof io === "undefined") {
      console.warn("⚠️ Socket.IO client not yet ready.");
      return;
    }

    const user = JSON.parse(localStorage.getItem("quantina_user_v5") || "{}");

    socket = io("wss://quantina-core-production.up.railway.app", {
      path: "/socket.io/",
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 3000,
      auth: {
        token: user.id || "guest_" + Math.random().toString(36).substring(2, 9),
      },
    });

    socket.on("connect", () => {
      console.log(`🟢 Connected to Quantina Core via Socket.IO as ${user.id}`);
    });

    socket.on("disconnect", () => {
      console.warn("🔴 Socket disconnected — will auto-retry...");
    });

    socket.on("receive_message", (msg) => {
      const text = msg.body_translated || msg.body || "[no text]";
      if (typeof addMsg === "function") {
        addMsg(`${msg.sender_id || "peer"}: ${text}`, false);
      }
    });
  }

  if (typeof io === "undefined") {
    const script = document.createElement("script");
    script.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
    script.onload = () => {
      console.log("✅ Socket.IO client loaded");
      initSocket();
    };
    document.head.appendChild(script);
  } else {
    initSocket();
  }

  // ==============================
  // 🔗 BACKEND ENDPOINTS
  // ==============================
  const CORE_BASE =
    location.hostname === "localhost"
      ? "http://localhost:4001"
      : "https://quantina-core-production.up.railway.app";
  const CORE_PEER_MSG = `${CORE_BASE}/api/peer-message`;

  // ---------- DOM HOOKS ----------
  const bubble = document.getElementById("qt-bubble");
  const panel = document.getElementById("qt-panel");
  const header = document.getElementById("qt-header");
  const body = document.getElementById("qt-body");
  const input = document.getElementById("qt-input");
  const sendBtn = document.getElementById("qt-send");
  const attachBtn = document.getElementById("qt-attach");
  const fileInput = document.getElementById("qt-file");
  const closeBtn = document.getElementById("qt-close");

  // ---------- LOCALSTORAGE KEYS ----------
  const LS_CHAT_HISTORY = "quantina_chat_history_v5";
  const LS_USER = "quantina_user_v5";
  const LS_LANG = "quantina_lang";

  // ---------- USER SESSION ----------
  const colors = ["#007bff", "#28a745", "#ff9800", "#9c27b0", "#00bcd4"];
  let user = JSON.parse(localStorage.getItem(LS_USER) || "null");
  if (!user) {
    user = {
      id: "user_" + Math.floor(Math.random() * 100000),
      name: "User_" + Math.floor(Math.random() * 900 + 100),
      color: colors[Math.floor(Math.random() * colors.length)],
    };
    localStorage.setItem(LS_USER, JSON.stringify(user));
  }

  // ---------- PANEL TOGGLE ----------
  bubble?.addEventListener("click", () => panel?.classList.toggle("qt-open"));
  closeBtn?.addEventListener("click", () => panel?.classList.remove("qt-open"));

  // ---------- DRAG PANEL ----------
  if (header && panel) {
    let dragging = false,
      sx = 0,
      sy = 0,
      sl = 0,
      st = 0;

    header.style.cursor = "grab";

    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const rect = panel.getBoundingClientRect();
      sl = rect.left;
      st = rect.top;
      header.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    function onMove(e) {
      if (!dragging) return;
      panel.style.position = "fixed";
      panel.style.left = sl + (e.clientX - sx) + "px";
      panel.style.top = st + (e.clientY - sy) + "px";
      panel.style.bottom = "auto";
      panel.style.right = "auto";
    }

    function onUp() {
      dragging = false;
      header.style.cursor = "grab";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
  }

  // ---------- UTIL ----------
  function scrollToBottom() {
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }

  function saveHistoryEntry(txt, me, time, status) {
    const hist = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
    hist.push({ text: txt, me, time, status });
    localStorage.setItem(LS_CHAT_HISTORY, JSON.stringify(hist));
  }

  // ---------- DATE HEADER ----------
  function showDateHeader() {
    if (!body) return;
    const existing = body.querySelector(".qt-date-header");
    if (existing) return;
    const dateHeader = document.createElement("div");
    dateHeader.className = "qt-date-header";
    const today = new Date().toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    dateHeader.textContent = today;
    body.appendChild(dateHeader);
  }

  // ---------- MESSAGE RENDER ----------
  function addMsg(txt, me, timeOverride = null, status = "✓", save = true) {
    if (!body) return;
    showDateHeader();

    const now = new Date();
    const msg = document.createElement("div");
    msg.className = "qt-msg " + (me ? "qt-me" : "qt-peer");

    const t =
      timeOverride ||
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const isHTML = /<.+?>/.test((txt || "").trim());
    msg.innerHTML = isHTML
      ? `${txt}<span class="qt-time">${t}</span>`
      : `<div class="qt-text">${txt}</div><span class="qt-time">${t}</span>`;

    msg.style.opacity = 0;
    body.appendChild(msg);
    requestAnimationFrame(() => {
      msg.style.opacity = 1;
    });
    scrollToBottom();

    if (save && !isHTML) {
      saveHistoryEntry(txt, me, t, status);
    }
  }

  // ---------- RESTORE CHAT ----------
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
    if (saved.length > 0) showDateHeader();
    saved.forEach((m) => addMsg(m.text, m.me, m.time, m.status, false));
  } catch (err) {
    console.warn("Restore chat failed:", err);
  }

  // =====================================================
  // 🔁 CORE PIPELINE (REST + Socket Hybrid)
  // =====================================================
  async function sendToCoreAndMaybeReply(userText) {
    const senderId = user.id;
    const receiverId = "peer_001";

    // ⚡ Live Socket Send
    if (socket && socket.connected) {
      socket.emit("send_message", {
        fromUserId: senderId,
        toUserId: receiverId,
        body: userText,
      });
      console.log("📤 Sent via socket:", userText);
    }

    // 🔁 REST Fallback + AI/Translate reply
    try {
      const res = await fetch(CORE_PEER_MSG, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: senderId,
          receiver_id: receiverId,
          text: userText,
          mode: "text",
        }),
      });

      const data = await res.json();
      console.log("🎯 Quantina Core Reply:", data);

      if (data.translated) addMsg(data.translated, false);
      else if (data.translated_text) addMsg(data.translated_text, false);
      else if (data.body_translated) addMsg(data.body_translated, false);
      else if (data.original) addMsg(data.original, false);
      else addMsg("⚠️ No translation received.", false);
    } catch (err) {
      console.error("❌ Core fetch error:", err);
      addMsg("⚠️ Network error — check Quantina Core.", false);
    }
  }

  // ---------- SEND MESSAGE ----------
  function doSend() {
    const text = (input?.value || "").trim();
    if (!text) return;
    addMsg(text, true);
    if (input) input.value = "";
    sendToCoreAndMaybeReply(text);
  }

  sendBtn?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  });

  // ---------- FILE UPLOAD ----------
  if (attachBtn && fileInput) {
    attachBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        addMsg(`📎 Uploaded: ${file.name}`, true);
        // hook to backend upload later if needed
      }
    });
  }

  // ---------- CLEAR CHAT ----------
  if (sendBtn && body) {
    const clearBtn = document.createElement("button");
    clearBtn.id = "qt-clear";
    clearBtn.textContent = "🧹";
    clearBtn.title = "Clear chat";
    clearBtn.style.cssText =
      "border:0;background:none;font-size:18px;margin-left:4px;cursor:pointer;color:#999;";
    sendBtn.parentNode.appendChild(clearBtn);

    clearBtn.addEventListener("click", () => {
      localStorage.removeItem(LS_CHAT_HISTORY);
      body.innerHTML = "";
      showDateHeader();
      addMsg("Chat cleared.", false);
    });
  }

// ---------- MIC (Whisper Transcribe Only - Manual Send) ----------
function initMicWhisperDetect(barEl, inputEl) {
  const micBtn = document.createElement("button");
  micBtn.id = "qt-mic";
  micBtn.type = "button";
  micBtn.title = "Voice input (Quantina Whisper)";
  micBtn.innerHTML = "🎤";
  micBtn.style.cssText =
    "border:0;background:none;font-size:20px;margin-left:6px;cursor:pointer;color:#0078ff;transition:color .2s,transform .15s;";
  barEl.appendChild(micBtn);

  let mediaRecorder, audioChunks = [];
  let recording = false;

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        // Only run upload once on stop
        if (audioChunks.length > 0) {
          await uploadAudio();
        }
      };

      mediaRecorder.start();
      recording = true;
      micBtn.style.color = "#00b894";
      micBtn.style.transform = "scale(1.2)";
    } catch (err) {
      console.error("🎤 Mic access failed:", err);
      alert("Please allow microphone access for voice input.");
    }
  }

  async function stopRecording() {
    if (mediaRecorder && recording) {
      recording = false;
      micBtn.style.color = "#0078ff";
      micBtn.style.transform = "scale(1)";
      mediaRecorder.stop();
    }
  }

  async function uploadAudio() {
    const blob = new Blob(audioChunks, { type: "audio/webm" });

    // Skip empty or small blobs
    if (blob.size < 2000) {
      console.warn("🛑 Empty or too-short blob:", blob.size, "bytes");
      addMsg("🎤 No speech detected — try again.", false);
      return;
    }

    // Check duration
    const audioDuration = await new Promise((resolve) => {
      const audio = document.createElement("audio");
      audio.src = URL.createObjectURL(blob);
      audio.addEventListener("loadedmetadata", () => resolve(audio.duration));
    });

    if (audioDuration < 0.5) {
      console.warn("🛑 Too short:", audioDuration.toFixed(2), "sec");
      addMsg("🎤 Speak a bit longer.", false);
      return;
    }

    // Measure amplitude RMS
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const raw = audioBuffer.getChannelData(0);
    const rms = Math.sqrt(raw.reduce((s, n) => s + n * n, 0) / raw.length);

    if (rms < 0.015) {
      console.warn(`🛑 Skipping silent audio (RMS=${rms.toFixed(4)})`);
      addMsg("🤫 No clear voice detected — try again.", false);
      return;
    }

    // Proceed only if valid speech
    const formData = new FormData();
    formData.append("mode", "voice");
    formData.append("audio", blob, "voice.webm");
    formData.append("sender_id", user.id || "guest");
    formData.append("receiver_id", "peer_001");

    addMsg("🎧 Processing voice input...", false, null, "🕒", false);

    try {
      const res = await fetch(`${CORE_BASE}/api/peer-message`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      console.log("🎯 Whisper Transcribe Response:", data);

      if (data && (data.translated || data.original)) {
        const transcript = data.translated || data.original;
        const detectedLang = data.sender_language || "auto";
        inputEl.value = transcript.trim();
        addMsg(`🎤 Detected [${detectedLang.toUpperCase()}]: ${transcript}`, true);
      } else {
        addMsg("⚠️ No transcription returned.", false);
      }
    } catch (err) {
      console.error("❌ Whisper upload failed:", err);
      addMsg("⚠️ Voice processing error.", false);
    }
  }

  micBtn.addEventListener("click", () => {
    if (!recording) startRecording();
    else stopRecording();
  });
}

const footerBar = input?.parentElement;
if (footerBar) initMicWhisperDetect(footerBar, input);
})();




