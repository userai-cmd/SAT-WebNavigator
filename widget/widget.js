(function () {
  "use strict";

  const script = document.currentScript;
  const apiUrl =
    (script && script.getAttribute("data-api")) ||
    window.SAT_WIDGET_API ||
    "http://localhost:3000";

  const CHAT_ICON =
    '<svg class="sat-widget-btn__icon sat-widget-btn__icon--chat" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>' +
    "</svg>";

  function mdToHtml(text) {
    if (!text) return "";
    return text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
  }

  function createEl(tag, className, html) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html != null) el.innerHTML = html;
    return el;
  }

  function getSessionId() {
    const KEY = "sat_widget_session";
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = "sess_" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (_e) {
      return "sess_" + Date.now();
    }
  }

  function apiBase() {
    return apiUrl.replace(/\/$/, "");
  }

  function loadStyles() {
    if (document.getElementById("sat-widget-styles")) return;
    const link = document.createElement("link");
    link.id = "sat-widget-styles";
    link.rel = "stylesheet";
    const base = apiUrl.replace(/\/$/, "");
    link.href = base + "/widget/widget.css?v=3";
    document.head.appendChild(link);
  }

  function init() {
    loadStyles();

    const root = createEl("div");
    root.id = "sat-widget-root";

    const overlay = createEl("button", "sat-widget-overlay");
    overlay.setAttribute("aria-label", "Закрити чат");
    overlay.type = "button";

    const panel = createEl("div", "sat-widget-panel");
    panel.innerHTML =
      '<div class="sat-widget-header">' +
      '<div class="sat-widget-header__logo">SAT</div>' +
      '<div class="sat-widget-header__text">' +
      "<h3>Помічник SAT</h3>" +
      "<p>Онлайн-консультант · sat.ua</p>" +
      "</div>" +
      '<button class="sat-widget-close" type="button" aria-label="Закрити">×</button>' +
      "</div>" +
      '<div class="sat-widget-messages"></div>' +
      '<div class="sat-quick-replies"></div>' +
      '<div class="sat-widget-actions">' +
      '<button type="button" class="sat-escalate-btn">Зв\'язатися з оператором</button>' +
      "</div>" +
      '<div class="sat-widget-input">' +
      '<input type="text" placeholder="Напишіть повідомлення…" autocomplete="off" />' +
      "<button type=\"button\">Надіслати</button></div>" +
      '<div class="sat-widget-footer">Транспортна компанія <a href="https://sat.ua" target="_blank" rel="noopener">SAT</a></div>';

    const btn = createEl("button", "sat-widget-btn");
    btn.type = "button";
    btn.setAttribute("aria-label", "Відкрити чат SAT");
    btn.innerHTML =
      CHAT_ICON + '<span class="sat-widget-btn__icon sat-widget-btn__icon--close" aria-hidden="true">×</span>';

    root.appendChild(overlay);
    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    const messagesEl = panel.querySelector(".sat-widget-messages");
    const quickEl = panel.querySelector(".sat-quick-replies");
    const input = panel.querySelector("input");
    const sendBtn = panel.querySelector(".sat-widget-input button");
    const closeBtn = panel.querySelector(".sat-widget-close");
    const escalateBtn = panel.querySelector(".sat-escalate-btn");

    const sessionId = getSessionId();
    let loading = false;
    let isOpen = false;
    let escalated = false;

    async function postJson(path, body) {
      await fetch(apiBase() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function addFeedbackActions(msgEl) {
      const actions = createEl("div", "sat-msg-actions");
      const up = createEl("button", "sat-feedback-btn", "👍");
      const down = createEl("button", "sat-feedback-btn", "👎");
      up.type = "button";
      down.type = "button";
      up.title = "Корисна відповідь";
      down.title = "Некорисна відповідь";

      function vote(rating) {
        up.disabled = true;
        down.disabled = true;
        actions.classList.add("sat-msg-actions--voted");
        postJson("/api/feedback", { sessionId, rating }).catch(function (e) {
          console.warn("[SAT Widget] feedback", e);
        });
      }

      up.addEventListener("click", function () { vote(1); });
      down.addEventListener("click", function () { vote(-1); });
      actions.appendChild(up);
      actions.appendChild(down);
      msgEl.appendChild(actions);
    }

    function addMessage(text, role, withFeedback) {
      const wrap = createEl("div", "sat-msg-wrap " + role);
      const msg = createEl("div", "sat-msg " + role, mdToHtml(text));
      wrap.appendChild(msg);
      if (role === "bot" && withFeedback !== false) {
        addFeedbackActions(wrap);
      }
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setQuickReplies(replies) {
      quickEl.innerHTML = "";
      if (!replies || !replies.length) return;
      replies.forEach(function (label) {
        const q = createEl("button", "sat-quick-btn", label);
        q.type = "button";
        q.addEventListener("click", function () {
          input.value = label;
          send();
        });
        quickEl.appendChild(q);
      });
    }

    function setLoading(on) {
      loading = on;
      sendBtn.disabled = on;
      const existing = panel.querySelector(".sat-typing");
      if (on && !existing) {
        messagesEl.appendChild(createEl("div", "sat-typing", "Помічник думає…"));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (!on && existing) {
        existing.remove();
      }
    }

    async function send() {
      const text = input.value.trim();
      if (!text || loading) return;
      input.value = "";
      setQuickReplies([]);
      addMessage(text, "user");
      setLoading(true);

      try {
        const res = await fetch(apiBase() + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Помилка сервера");
        const reply = data.reply || {};
        addMessage(reply.text || "Немає відповіді", "bot");
        setQuickReplies(reply.quickReplies);
      } catch (err) {
        addMessage("Не вдалося зв'язатися з сервером. Спробуйте пізніше.", "bot");
        console.error("[SAT Widget]", err);
      } finally {
        setLoading(false);
      }
    }

    async function escalate() {
      if (escalated) return;
      escalated = true;
      escalateBtn.disabled = true;
      escalateBtn.textContent = "Запит надіслано";
      addMessage(
        "Запит передано оператору. Зателефонуйте **0 800 30 99 09** або напишіть у [Telegram](https://t.me/sat_ua_bot).",
        "bot",
        false
      );
      try {
        await postJson("/api/event", { sessionId, type: "escalate" });
      } catch (e) {
        console.warn("[SAT Widget] escalate", e);
      }
    }

    function open() {
      isOpen = true;
      root.classList.add("sat-widget--open");
      panel.classList.add("open");
      btn.setAttribute("aria-label", "Закрити чат SAT");
      if (messagesEl.children.length === 0) {
        addMessage("Привіт! Я — помічник SAT 👋\n\nЧим можу допомогти?", "bot", false);
        setQuickReplies(["Послуги", "Тарифи", "Трекінг", "Відділення", "Кабінет"]);
      }
      input.focus();
    }

    function close() {
      isOpen = false;
      root.classList.remove("sat-widget--open");
      panel.classList.remove("open");
      btn.setAttribute("aria-label", "Відкрити чат SAT");
    }

    function toggle() {
      if (isOpen) close();
      else open();
    }

    btn.addEventListener("click", toggle);
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", close);
    escalateBtn.addEventListener("click", escalate);
    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
