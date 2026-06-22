(function () {
  "use strict";

  const script = document.currentScript;
  const apiUrl =
    (script && script.getAttribute("data-api")) ||
    window.SAT_WIDGET_API ||
    "http://localhost:3000";

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

  function loadStyles() {
    if (document.getElementById("sat-widget-styles")) return;
    const link = document.createElement("link");
    link.id = "sat-widget-styles";
    link.rel = "stylesheet";
    const base = apiUrl.replace(/\/$/, "");
    link.href = base + "/widget/widget.css";
    document.head.appendChild(link);
  }

  function init() {
    loadStyles();

    const root = createEl("div");
    root.id = "sat-widget-root";

    const panel = createEl("div", "sat-widget-panel");
    panel.innerHTML =
      '<div class="sat-widget-header">' +
      '<div><h3>Помічник SAT</h3><p>Онлайн-консультант</p></div>' +
      '<button class="sat-widget-close" aria-label="Закрити">×</button></div>' +
      '<div class="sat-widget-messages"></div>' +
      '<div class="sat-quick-replies"></div>' +
      '<div class="sat-widget-input">' +
      '<input type="text" placeholder="Напишіть повідомлення…" autocomplete="off" />' +
      "<button>Надіслати</button></div>";

    const btn = createEl("button", "sat-widget-btn");
    btn.setAttribute("aria-label", "Відкрити чат SAT");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    const messagesEl = panel.querySelector(".sat-widget-messages");
    const quickEl = panel.querySelector(".sat-quick-replies");
    const input = panel.querySelector("input");
    const sendBtn = panel.querySelector(".sat-widget-input button");
    const closeBtn = panel.querySelector(".sat-widget-close");

    let loading = false;

    function addMessage(text, role) {
      const msg = createEl("div", "sat-msg " + role, mdToHtml(text));
      messagesEl.appendChild(msg);
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
        messagesEl.appendChild(createEl("div", "sat-typing", "Думаю…"));
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
        const res = await fetch(apiUrl.replace(/\/$/, "") + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
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

    function open() {
      panel.classList.add("open");
      btn.style.display = "none";
      if (messagesEl.children.length === 0) {
        addMessage(
          "Привіт! Я — помічник SAT 👋\n\nЧим можу допомогти?",
          "bot"
        );
        setQuickReplies(["Послуги", "Тарифи", "Трекінг", "Відділення", "Кабінет"]);
      }
      input.focus();
    }

    function close() {
      panel.classList.remove("open");
      btn.style.display = "flex";
    }

    btn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
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
