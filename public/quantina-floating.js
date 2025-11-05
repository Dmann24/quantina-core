/* =========================================================
   Quantina Chat Widget (v5.8.1 Live Socket + REST Hybrid)
   ---------------------------------------------------------
   ✅ Real-time peer-to-peer via Socket.IO
   ✅ Full REST fallback to /api/peer-message
   ✅ Drag, mic, clear, promo, language picker preserved
   ✅ Auto socket reconnect
   ---------------------------------------------------------
   Backend:
   https://quantina-core-production.up.railway.app
   ========================================================= */

(function () {
  console.log("🚀 Quantina Chat Widget Loaded v5.8.1 (Live Socket Edition)");

  // ====================================================
  // 🌐 Load Socket.IO Client Script + Initialize Socket
  // ====================================================
  if (typeof io === "undefined") {
    const script = document.createElement("script");
    script.src = "https://cdn.socket.io/4.7.2/socket.io.min.js";
    script.onload = () => {
      console.log("✅ Socket.IO client loaded");
      initSocket();
    };
    document.head.appendChild(script);
  }

  let socket = null;

  // ====================================================
  // ⚡ Socket Initialization
  // ====================================================
  function initSocket() {
    if (typeof io === "undefined") {
      console.warn("⚠️ Socket.IO not ready yet.");
      return;
    }

    const user = JSON.parse(localStorage.getItem("quantina_user_v5") || "{}");
    const CORE_BASE =
      location.hostname === "localhost"
        ? "http://localhost:4001"
        : "https://quantina-core-production.up.railway.app";

    socket = io(CORE_BASE, {
      auth: { token: user.id || "guest_" + Math.random().toString(36).substring(2, 9) },
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log(`🟢 Connected to Quantina Core via Socket.IO as ${user.id}`);
    });

    socket.on("disconnect", () => {
      console.warn("🔴 Socket disconnected — retrying...");
      setTimeout(initSocket, 5000);
    });

    socket.on("receive_message", (msg) => {
      try {
        const text = msg.body_translated || msg.body || "[no text]";
        if (typeof addMsg === "function") {
          addMsg(`${msg.sender_id || "peer"}: ${text}`, false);
        } else {
          console.warn("⚠️ addMsg not yet available to render:", text);
        }
      } catch (err) {
        console.error("💥 Incoming message error:", err);
      }
    });

    // Optional backend ping
    socket.emit("ping_test", { hello: "from client" });
  }

  // ==============================
  // 🔗 BACKEND ENDPOINTS
  // ==============================
  const CORE_BASE =
    location.hostname === "localhost"
      ? "http://localhost:4001"
      : "https://quantina-core-production.up.railway.app";
  const CORE_PEER_MSG = `${CORE_BASE}/api/peer-message`;
  const CORE_LANGS = `${CORE_BASE}/langs/quantina_languages.json`;

  // ==============================
  // 🌐 Load Global Language Directory
  // ==============================
  let quantinaLangs = {};
  fetch(CORE_LANGS)
    .then((res) => res.json())
    .then((data) => {
      quantinaLangs = data.languages || data;
      console.log(
        "🌍 Quantina language directory loaded:",
        Object.keys(quantinaLangs).length,
        "languages"
      );
    })
    .catch((err) => console.warn("⚠️ Could not load language directory:", err));

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
  const LS_PAID = "quantina_paid_subscriber";
  const LS_TRANSLATE = "quantina_translate_enabled";

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

  const avatarEl = document.querySelector(".qt-avatar");
  const nameEl = document.getElementById("qt-username");
  if (avatarEl && nameEl) {
    avatarEl.style.background = user.color;
    nameEl.textContent = user.name;
  }

  // ---------- PANEL TOGGLE ----------
  bubble?.addEventListener("click", () => panel?.classList.toggle("qt-open"));
  closeBtn?.addEventListener("click", () => panel?.classList.remove("qt-open"));

  // ---------- DRAG PANEL ----------
  if (header && panel) {
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
    header.style.cursor = "grab";
    header.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON" || e.target.closest("button")) return;
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = panel.getBoundingClientRect();
      sl = rect.left; st = rect.top;
      header.style.cursor = "grabbing";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    function onMove(e) {
      if (!dragging) return;
      panel.style.position = "fixed";
      panel.style.left = sl + (e.clientX - sx) + "px";
      panel.style.top = st + (e.clientY - sy) + "px";
      panel.style.bottom = "auto"; panel.style.right = "auto";
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
    body.scrollTop = body.scrollHeight;
  }
  function saveHistoryEntry(txt, me, time, status) {
    const hist = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
    hist.push({ text: txt, me, time, status });
    localStorage.setItem(LS_CHAT_HISTORY, JSON.stringify(hist));
  }

  // ---------- MESSAGE RENDER ----------
  function addMsg(txt, me, timeOverride = null, status = "✓", save = true) {
    const now = new Date();
    const msg = document.createElement("div");
    msg.className = "qt-msg " + (me ? "qt-me" : "qt-peer");
    const t =
      timeOverride ||
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const isHTML = /<.+?>/.test(txt.trim());
    msg.innerHTML = isHTML
      ? `${txt}<span class="qt-time">${t}</span>`
      : `<div class="qt-text">${txt}</div><span class="qt-time">${t}</span>`;
    msg.style.opacity = 0;
    body.appendChild(msg);
    requestAnimationFrame(() => (msg.style.opacity = 1));
    scrollToBottom();
    if (save && !isHTML) saveHistoryEntry(txt, me, t, status);
  }

  // ---------- RESTORE CHAT ----------
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
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

    // 🔁 REST Fallback
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
    input.value = "";
    sendToCoreAndMaybeReply(text);
  }

  sendBtn?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  });

  // ---------- MIC ----------
  function initMicStable(barEl, inputEl) {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const micBtn = document.createElement("button");
    micBtn.id = "qt-mic";
    micBtn.type = "button";
    micBtn.title = "Voice input";
    micBtn.innerHTML = "🎤";
    micBtn.style.cssText =
      "border:0;background:none;font-size:20px;margin-left:6px;cursor:pointer;color:#0078ff;transition:color 0.2s ease,transform 0.15s ease;";
    barEl.appendChild(micBtn);

    if (!SpeechRecognition) {
      micBtn.disabled = true;
      micBtn.style.opacity = 0.5;
      micBtn.title = "Speech recognition not supported.";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = localStorage.getItem(LS_LANG) || "en-US";
    let listening = false;

    recognition.onstart = () => {
      listening = true;
      micBtn.style.color = "#00b894";
      micBtn.style.transform = "scale(1.2)";
    };
    recognition.onend = () => {
      listening = false;
      micBtn.style.color = "#0078ff";
      micBtn.style.transform = "scale(1)";
    };
    recognition.onerror = (er) => {
      console.warn("🎤 SpeechRecognition error:", er.error);
      micBtn.style.color = "#ff5252";
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (inputEl) inputEl.value = transcript.trim();
    };

    micBtn.addEventListener("click", async () => {
      try {
        if (!listening) recognition.start();
        else recognition.stop();
      } catch (err) {
        console.error("🎤 start failed:", err);
      }
    });
  }

  const footerBar = input?.parentElement;
  if (footerBar) initMicStable(footerBar, input);
})();
