/* =========================================================
   Quantina Chat Widget (v5.7.2 + Railway Live Core)
   Goals:
   - keep previous working behavior (drag, attach, mic, clear chat)
   - stop promo spam (only once per free session)
   - keep language picker
   - wire chat to live Quantina Core on Railway

   Backend:
   https://quantina-core-production.up.railway.app

   Socket usage:
   - connect user.id to core
   - send messages peer-to-peer
   - receive translated replies

   REST fallback:
   - /api/peer-message for reliability if socket misses

   Premium logic:
   - If LS_PAID !== "true": show promo once, no AI spend
   - If LS_PAID === "true": actually talk to backend (AI + translation)
   ========================================================= */

(function () {
  console.log("🚀 Quantina Chat Widget Loaded v5.7.2 (Railway edition)");

  // ==============================
  // 🔗 BACKEND ENDPOINTS
  // ==============================
  const CORE_BASE = "https://quantina-core-production.up.railway.app";
  const CORE_HEALTH = `${CORE_BASE}/api/health`;
  const CORE_PEER_MSG = `${CORE_BASE}/api/peer-message`;
  const CORE_LANGS = `${CORE_BASE}/assets/langs/quantina_languages.json`; 
  // ^ if you serve langs from Railway /public/assets/langs
  // If languages.json is still local in WP instead, switch back to "/assets/langs/quantina_languages.json"

  // ==============================
  // 🌐 Load Global Language Directory
  // ==============================
  let quantinaLangs = {};
  let selectedLang = localStorage.getItem("quantina_lang") || "en";

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
    .catch((err) =>
      console.warn("⚠️ Could not load language directory:", err)
    );

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
  const LS_PAID = "quantina_paid_subscriber"; // "true" means billable / pro user
  const LS_TRANSLATE = "quantina_translate_enabled";
  const LS_PROMO_SHOWN = "quantina_promo_shown_v1"; // prevent promo spam

  // ---------- STATE ----------
  let lastDate = "";
  let promoShown = localStorage.getItem(LS_PROMO_SHOWN) === "true";

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
  } else {
    // If old sessions didn’t have an id, add one
    if (!user.id) {
      user.id = "user_" + Math.floor(Math.random() * 100000);
      localStorage.setItem(LS_USER, JSON.stringify(user));
    }
  }

  const avatarEl = document.querySelector(".qt-avatar");
  const nameEl = document.getElementById("qt-username");
  if (avatarEl && nameEl) {
    avatarEl.style.background = user.color;
    nameEl.textContent = user.name;
  }

  // ---------- HEALTH CHECK (for debug only) ----------
  fetch(CORE_HEALTH)
    .then((r) => r.json())
    .then((d) => console.log("✅ Core health:", d))
    .catch(() => console.warn("⚠️ Could not reach Quantina Core backend."));

  // ---------- SOCKET.IO (live link to Quantina Core) ----------
  // We assume socket.io client script is already loaded on the page.
  // e.g. <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
  let socket = null;
  if (window.io) {
    socket = window.io(CORE_BASE, {
      auth: { token: user.id },
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("🟢 Connected to Quantina Core via Socket.IO as", user.id);
    });

    socket.on("disconnect", () => {
      console.warn("🔴 Socket disconnected from Quantina Core");
    });

    // When another peer (or AI acting as peer) sends us a translated message
    socket.on("receive_message", (msg) => {
      // msg.body is already translated for this user per backend logic
      const display = msg.body || msg.body_translated || "[no text]";
      addMsg(`${msg.sender_id || "peer"}: ${display}`, false);
    });

    // When our own message is acknowledged
    socket.on("message_sent", (ack) => {
      // we could update status ticks here if we want
      // console.log("📨 message_sent ack:", ack);
    });

    socket.on("message_error", (err) => {
      console.warn("⚠️ message_error:", err);
      addMsg("⚠️ Message delivery error.", false);
    });
  } else {
    console.warn(
      "⚠️ socket.io client not found on page. Live chat will fallback to REST only."
    );
  }

  // ---------- PANEL TOGGLE ----------
  if (bubble && panel) {
    bubble.addEventListener("click", () => {
      panel.classList.toggle("qt-open");
    });
  }
  closeBtn?.addEventListener("click", () => {
    panel.classList.remove("qt-open");
  });

  // ---------- DRAG PANEL ----------
  if (header && panel) {
    let dragging = false;
    let sx = 0,
      sy = 0,
      sl = 0,
      st = 0;

    header.style.cursor = "grab";

    header.addEventListener("mousedown", (e) => {
      // don't start drag if clicking a header button
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
      // kill bottom/right so it stays where we drop it
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

    // date separator if new day label
    const todayLabel = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (todayLabel !== lastDate) {
      const sep = document.createElement("div");
      sep.className = "qt-date-separator";
      sep.textContent = todayLabel;
      body.appendChild(sep);
      lastDate = todayLabel;
    }

    const msg = document.createElement("div");
    msg.className = "qt-msg " + (me ? "qt-me" : "qt-peer");

    const t =
      timeOverride ||
      now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

    const isHTML = /<.+?>/.test(txt.trim());

    if (isHTML) {
      msg.innerHTML = `
        ${txt}
        <span class="qt-time">${t} <span class="qt-status">${status}</span></span>
      `;
    } else {
      msg.innerHTML = `
        <div class="qt-text">${txt}</div>
        <span class="qt-time">${t} <span class="qt-status">${status}</span></span>
      `;
    }

    msg.style.opacity = 0;
    body.appendChild(msg);
    requestAnimationFrame(() => {
      msg.style.opacity = 1;
    });

    scrollToBottom();

    // keep "system cards" (HTML promo) out of saved history
    if (save && !isHTML) {
      saveHistoryEntry(txt, me, t, status);
    }
  }

  // ---------- RESTORE CHAT ON LOAD ----------
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
    saved.forEach((m) => {
      addMsg(m.text, m.me, m.time, m.status, false);
    });
  } catch (err) {
    console.warn("Restore chat failed:", err);
  }

  // ---------- MULTILINGUAL PROMO CARD ----------
  function renderPromoCard() {
    const promoHTML = `
      <div class="qt-promo-card" style="
        background:linear-gradient(145deg,#f0f7ff,#ffffff);
        border:1px solid #cce0ff;
        border-radius:12px;
        padding:10px 14px;
        margin:6px 0;
        box-shadow:0 4px 14px rgba(0,120,255,0.15);
        font-size:14px;
        line-height:1.5;
      ">
        🌐 <strong>Unlock Quantina Multilingual Access</strong><br>
        Experience real-time AI conversation in any language —
        <em>Seamless. Smart. Global.</em><br><br>

        <button class="qt-upgrade-yes"
          style="background:#0078ff;color:#fff;border:0;
          border-radius:6px;padding:6px 14px;cursor:pointer;">
          Yes, Unlock
        </button>

        <button class="qt-upgrade-no"
          style="margin-left:8px;background:#e0e0e0;border:0;
          border-radius:6px;padding:6px 14px;cursor:pointer;">
          Not Now
        </button>
      </div>
    `;

    addMsg(promoHTML, false, null, "✓", false);
  }

  // Shown once per free session after first real send
  function showPromoOnceAfterFirstSend() {
    if (promoShown) return;
    promoShown = true;
    localStorage.setItem(LS_PROMO_SHOWN, "true");
    renderPromoCard();
  }

  // Manual promo trigger (globe button)
  function forceShowPromo() {
    renderPromoCard();
  }

  // =====================================================
  // 🔁 CORE MESSAGE PIPELINE
  // =====================================================
  // We support two paths:
  // 1. Live socket emit
  // 2. REST fallback /api/peer-message
  //
  // We only spend tokens (and translate) if LS_PAID==="true"
  // Free user still sees their own bubble + 1-time promo, but no AI cost.
  // =====================================================

  async function sendToCoreAndMaybeReply(userText) {
    const isPaid = localStorage.getItem(LS_PAID) === "true";
    const translateOn = localStorage.getItem(LS_TRANSLATE) === "true";
    // you already store language choice in LS_LANG (or navigator.language)
    const langPref =
      localStorage.getItem(LS_LANG) || navigator.language || "en-US";

    // if user isn't paid, we do NOT call backend (saves you cost)
    if (!isPaid) {
      return;
    }

    // Try socket first (live peer message)
    // We'll assume a pseudo peer for now, like "peer_001".
    const peerId = "peer_001";
    if (socket && socket.connected) {
      socket.emit("send_message", {
        fromUserId: user.id,
        toUserId: peerId,
        body: userText,
        // We could also send langPref or translateOn here later if you want
      });
    }

    // REST fallback so we still get a reply if socket doesn't deliver in time
    try {
      const res = await fetch(CORE_PEER_MSG, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_id: user.id,
          receiver_id: peerId,
          text: userText,
          // not strictly required by core right now,
          // but you could extend backend to respect these:
          // langPref,
          // translateOn
        }),
      });

      const data = await res.json();
      if (data && data.body_translated) {
        // AI/translated reply from core
        addMsg(data.body_translated, false);
      } else if (data && data.success && data.body_original) {
        // At least show something
        addMsg(data.body_original, false);
      } else {
        addMsg("⚠️ No response from AI.", false);
      }
    } catch (err) {
      console.error("AI fetch fallback error:", err);
      addMsg("⚠️ Network error — try again.", false);
    }
  }

  // ---------- SEND MESSAGE ----------
  function doSend() {
    const text = (input?.value || "").trim();
    if (!text) return;

    // Show user's local bubble
    addMsg(text, true);
    input.value = "";

    const isPaid = localStorage.getItem(LS_PAID) === "true";
    if (!isPaid) {
      // free user sees promo once, and does not trigger AI usage
      showPromoOnceAfterFirstSend();
    }

    // paid users get real translation/AI through core
    sendToCoreAndMaybeReply(text);
  }

  sendBtn?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  });

  // ---------- FILE ATTACH ----------
  attachBtn?.addEventListener("click", () => {
    if (fileInput) fileInput.click();
  });

  fileInput?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const sizeKB = (f.size / 1024).toFixed(1) + " KB";
    addMsg(`📎 <strong>${f.name}</strong> <em>(${sizeKB})</em>`, true);
    // NOTE: not uploading file to backend yet.
    // You can POST via FormData to CORE_BASE later if you add /api/upload.
  });

  // ---------- FOOTER BAR BUTTONS (trash / globe / mic / translate toggle) ----------
  const footerBar = input?.parentElement;
  if (footerBar) {
    footerBar.style.display = "flex";
    footerBar.style.alignItems = "center";
    footerBar.style.gap = "6px";

    // 🗑 clear chat
    const clearBtn = document.createElement("button");
    clearBtn.innerHTML = "🗑️";
    clearBtn.title = "Clear chat";
    clearBtn.style.cssText =
      "background:none;border:0;margin-left:6px;font-size:18px;cursor:pointer;opacity:.8;";
    clearBtn.addEventListener("click", () => {
      if (confirm("Clear all chat messages?")) {
        body.innerHTML = "";
        localStorage.removeItem(LS_CHAT_HISTORY);

        // reset session state for date + promo
        lastDate = "";
        promoShown = false;
        localStorage.removeItem(LS_PROMO_SHOWN);

        addMsg("🗑️ Chat cleared.", false, null, "✓", false);
      }
    });
    footerBar.appendChild(clearBtn);

    // 🌍 translate toggle (premium only visual / state)
    const translateBtn = document.createElement("button");
    translateBtn.innerHTML = "🌍";
    translateBtn.title = "AI Translate Mode (Premium Only)";
    translateBtn.style.cssText =
      "background:none;border:0;font-size:18px;cursor:pointer;";

    function refreshTranslateUI() {
      const on = localStorage.getItem(LS_TRANSLATE) === "true";
      if (on) {
        translateBtn.style.color = "#00b894";
        translateBtn.style.textShadow = "0 0 6px rgba(0,184,148,.7)";
      } else {
        translateBtn.style.color = "#666";
        translateBtn.style.textShadow = "none";
      }
    }

    if (localStorage.getItem(LS_PAID) === "true") {
      translateBtn.addEventListener("click", () => {
        const cur = localStorage.getItem(LS_TRANSLATE) === "true";
        localStorage.setItem(LS_TRANSLATE, cur ? "false" : "true");
        addMsg(
          cur
            ? "🌐 AI Translate Mode Disabled."
            : "🌐 AI Translate Mode Enabled.",
          false,
          null,
          "✓",
          false
        );
        refreshTranslateUI();
      });
    } else {
      // not premium -> locked look
      translateBtn.style.opacity = 0.5;
      translateBtn.style.cursor = "not-allowed";
    }

    refreshTranslateUI();
    footerBar.appendChild(translateBtn);

    // 🌐 globe promo trigger (manual upsell card)
    const globeBtn = document.createElement("button");
    globeBtn.innerHTML = "🌐";
    globeBtn.title = "Unlock Quantina Multilingual Access";
    globeBtn.style.cssText =
      "background:none;border:0;font-size:20px;cursor:pointer;color:#0078ff;";
    globeBtn.addEventListener("click", () => {
      forceShowPromo();
    });
    footerBar.appendChild(globeBtn);

    // 🎤 microphone (stable rollback logic you trust)
    initMicStable(footerBar, input);
  }

  // ---------- PROMO YES/NO CLICKS ----------
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("qt-upgrade-yes")) {
      addMsg(
        "✨ Redirecting you to upgrade your Quantina experience...",
        false,
        null,
        "✓",
        false
      );
      // send them to plans/upgrade (you can change this URL)
      window.open("/pricing", "_blank");
    }
    if (e.target.classList.contains("qt-upgrade-no")) {
      addMsg(
        "👍 No worries — you can unlock it anytime.",
        false,
        null,
        "✓",
        false
      );
    }
  });

  // ---------- MIC (STABLE ROLLBACK LOGIC) ----------
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
      micBtn.title = "Speech recognition not supported in this browser.";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang =
      localStorage.getItem(LS_LANG) || navigator.language || "en-US";

    let listening = false;

    recognition.onstart = () => {
      listening = true;
      micBtn.style.color = "#00b894";
      micBtn.style.transform = "scale(1.2)";
      micBtn.title = "Listening... click to stop";
    };

    recognition.onend = () => {
      listening = false;
      micBtn.style.color = "#0078ff";
      micBtn.style.transform = "scale(1)";
      micBtn.title = "Voice input";
    };

    recognition.onerror = (er) => {
      console.warn("🎤 SpeechRecognition error:", er.error);
      micBtn.style.color = "#ff5252";
      micBtn.title = "Microphone error — check permissions or HTTPS";
      listening = false;
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
        if (!listening) {
          // Try permission check (not all browsers support navigator.permissions)
          if (navigator.permissions) {
            try {
              const perm = await navigator.permissions.query({
                name: "microphone",
              });
              if (perm && perm.state === "denied") {
                alert(
                  "Microphone access is blocked. Please allow it in browser settings."
                );
                return;
              }
            } catch (_) {}
          }
          recognition.start();
        } else {
          recognition.stop();
        }
      } catch (err) {
        console.error("🎤 start failed:", err);
        micBtn.style.color = "#ff5252";
        micBtn.title = "Error activating microphone";
      }
    });
  }
})();

/* ======================================================
   🌍 Quantina Global Language Picker (v1.0)
   Keeps working. Lets the user pick UI/translation lang.
   We reuse CORE_LANGS here too so it's consistent.
   ====================================================== */

(function initQuantinaLangPicker() {
  const inputBar = document.querySelector(".qtm-input-bar");
  if (!inputBar) {
    console.warn("🌍 Input bar not found, skipping language picker init.");
    return;
  }

fetch('https://quantina-core-production.up.railway.app/langs/quantina_languages.json')


    .then((res) => res.json())
    .then((data) => {
      const langs = data.languages || data;
      const currentLang = localStorage.getItem("quantina_lang") || "en";

      const langPicker = document.createElement("select");
      langPicker.id = "qt-lang-picker";
      langPicker.style.cssText = `
        border:1px solid #ccc;
        border-radius:8px;
        padding:4px 8px;
        font-size:13px;
        margin-left:6px;
        background:#fff;
        cursor:pointer;
      `;

      Object.entries(langs).forEach(([code, info]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${info.flag} ${info.native}`;
        if (code === currentLang) opt.selected = true;
        langPicker.appendChild(opt);
      });

      langPicker.addEventListener("change", (e) => {
        const selected = e.target.value;
        localStorage.setItem("quantina_lang", selected);
        const info = langs[selected];
        console.log(
          `🌐 Language switched to ${info?.name || selected} (${selected})`
        );
      });

      inputBar.appendChild(langPicker);
      console.log("✅ Quantina language picker initialized.");
    })
    .catch((err) =>
      console.error("⚠️ Failed to load language directory:", err)
    );
})();
