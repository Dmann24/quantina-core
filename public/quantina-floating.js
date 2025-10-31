/* =========================================================
   Quantina Chat Widget (v5.7.2 rollback-stable)
   Goal:
   - keep previous working behavior (drag, attach, UI)
   - stop promo spam
   - keep mic alive
   ========================================================= */

(function () {
  console.log("🚀 Quantina Chat Widget Loaded v5.7.2");
// ==============================
// 🌐 Load Global Language Directory
// ==============================
let quantinaLangs = {};
let selectedLang = localStorage.getItem('quantina_lang') || 'en';

fetch('/assets/langs/quantina_languages.json')
  .then(res => res.json())
  .then(data => {
    quantinaLangs = data.languages;
    console.log("🌍 Quantina language directory loaded:", Object.keys(quantinaLangs).length, "languages");
  })
  .catch(err => console.warn("⚠️ Could not load language directory:", err));

  // ---------- DOM HOOKS ----------
  const bubble    = document.getElementById("qt-bubble");
  const panel     = document.getElementById("qt-panel");
  const header    = document.getElementById("qt-header");
  const body      = document.getElementById("qt-body");
  const input     = document.getElementById("qt-input");
  const sendBtn   = document.getElementById("qt-send");
  const attachBtn = document.getElementById("qt-attach");
  const fileInput = document.getElementById("qt-file");
  const closeBtn  = document.getElementById("qt-close");

  // ---------- LOCALSTORAGE KEYS ----------
  const LS_CHAT_HISTORY   = "quantina_chat_history_v5";
  const LS_USER           = "quantina_user_v5";
  const LS_LANG           = "quantina_lang";
  const LS_PAID           = "quantina_paid_subscriber";
  const LS_TRANSLATE      = "quantina_translate_enabled";
  const LS_PROMO_SHOWN    = "quantina_promo_shown_v1"; 
  // ^ new versioned key so old bad state doesn't stick

  // ---------- STATE ----------
  let lastDate = "";
  // promoShown is true if we've already shown the upsell this session OR it's recorded in LS
  let promoShown = localStorage.getItem(LS_PROMO_SHOWN) === "true";

  // ---------- USER SESSION ----------
  const colors = ["#007bff", "#28a745", "#ff9800", "#9c27b0", "#00bcd4"];
  let user = JSON.parse(localStorage.getItem(LS_USER) || "null");
  if (!user) {
    user = {
      name: "User_" + Math.floor(Math.random() * 900 + 100),
      color: colors[Math.floor(Math.random() * colors.length)],
    };
    localStorage.setItem(LS_USER, JSON.stringify(user));
  }

  const avatarEl  = document.querySelector(".qt-avatar");
  const nameEl    = document.getElementById("qt-username");
  if (avatarEl && nameEl) {
    avatarEl.style.background = user.color;
    nameEl.textContent = user.name;
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

  // ---------- DRAG PANEL (keep what was working) ----------
  if (header && panel) {
    let dragging = false;
    let sx = 0, sy = 0, sl = 0, st = 0;

    header.style.cursor = "grab";

    header.addEventListener("mousedown", (e) => {
      // don't start drag if they clicked a button in the header
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
      panel.style.top  = st + (e.clientY - sy) + "px";
      // kill bottom/right so it stays where we drop it
      panel.style.bottom = "auto";
      panel.style.right  = "auto";
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

    // date separator
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

    const t = timeOverride || now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const isHTML = /<.+?>/.test(txt.trim());

    if (isHTML) {
      // treat txt as trusted bubble content (promo card, system cards)
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
    requestAnimationFrame(() => { msg.style.opacity = 1; });

    scrollToBottom();

    if (save && !isHTML) {
      saveHistoryEntry(txt, me, t, status);
    }
  }

  // ---------- RESTORE CHAT ON LOAD ----------
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CHAT_HISTORY) || "[]");
    saved.forEach(m => {
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

  // (A) automatic promo logic for free users
  // showPromoOnceAfterFirstSend() will:
  // - only run the first time user sends a message THIS session if no promoShown yet
  // - then permanently remember we showed it by writing LS key
  function showPromoOnceAfterFirstSend() {
    if (promoShown) return; // already shown this session or recorded in LS
    // mark it
    promoShown = true;
    localStorage.setItem(LS_PROMO_SHOWN, "true");
    // render card now
    renderPromoCard();
  }

  // (B) manual promo trigger (globe button). This DOES NOT flip promoShown.
  // That means user can tap globe and see promo any time.
  function forceShowPromo() {
    renderPromoCard();
  }

  // ---------- AI REPLY (same logic except: if paid -> talk/translate; if not paid -> don't auto promo spam again) ----------
  async function handleAIReply(userText) {
    const isPaid = localStorage.getItem(LS_PAID) === "true";
    const translateOn = localStorage.getItem(LS_TRANSLATE) === "true";
    const lang = localStorage.getItem(LS_LANG) || navigator.language || "en-US";

    if (!isPaid) {
      // user is not paid
      // DO NOT auto-spam promo every message anymore
      // Just silently skip AI here.
      return;
    }

    // paid flow
    addMsg("⏳ Quantina is thinking...", false);

    const endpoint = translateOn
      ? "https://quantinasaas.com/api/ai-translate-chat"
      : "https://quantinasaas.com/api/ai-chat";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userText,
          language: lang,
          user: user.name,
        }),
      });

      const data = await res.json();
      if (data && data.reply) {
        addMsg(data.reply, false);
      } else {
        addMsg("⚠️ No response from AI.", false);
      }
    } catch (err) {
      console.error("AI fetch error:", err);
      addMsg("⚠️ Network error — try again.", false);
    }
  }

  // ---------- SEND MESSAGE ----------
  function doSend() {
    const text = (input?.value || "").trim();
    if (!text) return;

    // display user's message
    addMsg(text, true);
    input.value = "";

    // IF this is the first user message after load/reset and user is not premium,
    // then show the promo card exactly ONCE.
    const isPaid = localStorage.getItem(LS_PAID) === "true";
    if (!isPaid) {
      // showPromoOnceAfterFirstSend() internally checks promoShown + sets LS
      showPromoOnceAfterFirstSend();
    }

    // now try to get AI reply
    handleAIReply(text);
  }

  sendBtn?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  });

  // ---------- FILE ATTACH ----------
  // keep original behavior you said used to work
  attachBtn?.addEventListener("click", () => {
    if (fileInput) fileInput.click();
  });

  fileInput?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const sizeKB = (f.size / 1024).toFixed(1) + " KB";
    addMsg(`📎 <strong>${f.name}</strong> <em>(${sizeKB})</em>`, true);
  });

  // ---------- FOOTER BAR BUTTONS (trash / globe / mic / translate toggle) ----------
  const footerBar = input?.parentElement;
  if (footerBar) {
    footerBar.style.display = "flex";
    footerBar.style.alignItems = "center";
    footerBar.style.gap = "6px";

    // 🗑 clear chat button
    const clearBtn = document.createElement("button");
    clearBtn.innerHTML = "🗑️";
    clearBtn.title = "Clear chat";
    clearBtn.style.cssText =
      "background:none;border:0;margin-left:6px;font-size:18px;cursor:pointer;opacity:.8;";
    clearBtn.addEventListener("click", () => {
      if (confirm("Clear all chat messages?")) {
        body.innerHTML = "";
        localStorage.removeItem(LS_CHAT_HISTORY);

        // reset session state
        lastDate = "";

        // IMPORTANT:
        // when they clear chat, we want promo to be allowed
        // again for first message
        promoShown = false;
        localStorage.removeItem(LS_PROMO_SHOWN);

        addMsg("🗑️ Chat cleared.", false, null, "✓", false);
      }
    });
    footerBar.appendChild(clearBtn);

    // 🌍 translate toggle (premium only)
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

    // 🌐 globe promo trigger (manual)
    const globeBtn = document.createElement("button");
    globeBtn.innerHTML = "🌐";
    globeBtn.title = "Unlock Quantina Multilingual Access";
    globeBtn.style.cssText =
      "background:none;border:0;font-size:20px;cursor:pointer;color:#0078ff;";
    globeBtn.addEventListener("click", () => {
      forceShowPromo();
    });
    footerBar.appendChild(globeBtn);

    // 🎤 mic (ROLLBACK version that you said worked before we added toggle etc.)
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
      // open plans page new tab
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
  // This is the simpler mic that was working for you:
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
      micBtn.title =
        "Speech recognition not supported in this browser.";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang =
      localStorage.getItem(LS_LANG) ||
      navigator.language ||
      "en-US";

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

    recognition.onerror = (e) => {
      console.warn("🎤 SpeechRecognition error:", e.error);
      micBtn.style.color = "#ff5252";
      micBtn.title =
        "Microphone error — check permissions or HTTPS";
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
          // try permission check, but don't crash if browser doesn't support
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
            } catch {}
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
// ======================================================
// 🌍 Quantina Global Language Picker (v1.0)
// ======================================================

(function initQuantinaLangPicker() {
  const inputBar = document.querySelector(".qtm-input-bar");
  if (!inputBar) {
    console.warn("🌍 Input bar not found, skipping language picker init.");
    return;
  }

  // Load global language directory
  fetch("/assets/langs/quantina_languages.json")
    .then(res => res.json())
    .then(data => {
      const langs = data.languages;
      const currentLang = localStorage.getItem("quantina_lang") || "en";

      // Create select dropdown
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

      // Populate languages
      Object.entries(langs).forEach(([code, info]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${info.flag} ${info.native}`;
        if (code === currentLang) opt.selected = true;
        langPicker.appendChild(opt);
      });

      // Handle language change
      langPicker.addEventListener("change", (e) => {
        const selected = e.target.value;
        localStorage.setItem("quantina_lang", selected);
        const info = langs[selected];
        console.log(`🌐 Language switched to ${info.name} (${selected})`);
      });

      // Append picker to chat bar
      inputBar.appendChild(langPicker);
      console.log("✅ Quantina language picker initialized.");
    })
    .catch(err => console.error("⚠️ Failed to load language directory:", err));
})();
