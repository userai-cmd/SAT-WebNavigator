const { loadKnowledgeBase, getBotResponse, searchKnowledgeBase } = require("./kb");
const { retrieve } = require("./rag");
const { generateReply, isEnabled } = require("./llm");

const TRACKING_NUMBER_RE = /\b\d{10,20}\b/;

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectTrackingNumber(query) {
  const match = query.match(TRACKING_NUMBER_RE);
  return match ? match[0] : null;
}

function isTrackingIntent(query) {
  const q = normalize(query);
  return /відстеж|трекінг|де (мій |моя )?(вантаж|посилк)|статус|номер накладн/.test(q);
}

function isCalculatorIntent(query) {
  const q = normalize(query);
  return /розрахув|калькулятор|порахув|скільки коштує|вартість доставк/.test(q);
}

function isCabinetIntent(query) {
  const q = normalize(query);
  return /кабінет|cabinet|реєстрац|увійти|логін|створити накладн/.test(q);
}

function isGreeting(query) {
  const q = normalize(query);
  return /^(привіт|вітаю|доброго дня|добрий день|hello|hi)([!.?\s]|$)/.test(q);
}

function handleTracking(query) {
  const number = detectTrackingNumber(query);
  if (number) {
    return {
      text:
        `Перевіряю накладну **${number}**.\n\n` +
        `Поки API SAT не підключено — відкрийте трекінг на сайті:\n` +
        `👉 [sat.ua/tracking](https://sat.ua/tracking)\n\n` +
        `Введіть номер накладної у поле «Відстежити».`,
      intent: "tracking",
      trackingNumber: number,
      links: [{ label: "Відстежити на sat.ua", url: "https://sat.ua/tracking" }],
    };
  }
  if (isTrackingIntent(query)) {
    return {
      text:
        "Щоб відстежити відправлення, вкажіть **номер накладної**.\n\n" +
        "Або перейдіть на сторінку трекінгу:\n" +
        "👉 [sat.ua/tracking](https://sat.ua/tracking)",
      intent: "tracking",
      links: [{ label: "Трекінг SAT", url: "https://sat.ua/tracking" }],
    };
  }
  return null;
}

function handleCalculator(query) {
  if (!isCalculatorIntent(query)) return null;
  const results = searchKnowledgeBase(query, 1);
  const hint = results[0] ? `\n\n${getBotResponse(results[0].entry)}` : "";
  return {
    text:
      "Точний розрахунок — у **калькуляторі SAT**:\n" +
      "👉 [sat.ua/calculator](https://sat.ua/calculator)\n\n" +
      "Вкажіть міста відправлення/отримання, тип і вагу вантажу." +
      hint,
    intent: "calculator",
    links: [{ label: "Калькулятор SAT", url: "https://sat.ua/calculator" }],
  };
}

function handleCabinet(query) {
  if (!isCabinetIntent(query)) return null;
  const results = searchKnowledgeBase(query, 1);
  if (results[0]) {
    return {
      text:
        getBotResponse(results[0].entry) +
        "\n\n🔗 [cabinet.sat.ua](https://cabinet.sat.ua/login)",
      intent: "cabinet",
      links: [{ label: "Особистий кабінет", url: "https://cabinet.sat.ua/login" }],
    };
  }
  return {
    text:
      "Особистий кабінет SAT: [cabinet.sat.ua](https://cabinet.sat.ua/login)\n\n" +
      "Там можна створити накладну, порахувати вартість і переглянути історію відправлень.",
    intent: "cabinet",
    links: [{ label: "Увійти в кабінет", url: "https://cabinet.sat.ua/login" }],
  };
}

function handleGreeting() {
  return {
    text:
      "Привіт! Я — помічник SAT 👋\n\n" +
      "Чим можу допомогти?\n" +
      "• Дізнатися про послуги\n" +
      "• Розрахувати вартість\n" +
      "• Відстежити вантаж\n" +
      "• Знайти відділення\n" +
      "• Допомогти з особистим кабінетом",
    intent: "greeting",
    quickReplies: ["Послуги", "Тарифи", "Трекінг", "Відділення", "Кабінет"],
  };
}

function fallbackReply() {
  return {
    text:
      "На жаль, не знайшов точної відповіді у базі знань.\n\n" +
      "Спробуйте переформулювати питання або:\n" +
      "📞 Зв'яжіться з SAT: [info@sat.ua](mailto:info@sat.ua)\n" +
      "🌐 [sat.ua](https://sat.ua)",
    intent: "fallback",
    quickReplies: ["Послуги", "Тарифи", "Трекінг", "Контакти"],
  };
}

async function chatWithRag(message) {
  const contexts = await retrieve(message);

  if (!contexts.length) {
    return fallbackReply();
  }

  if (!isEnabled()) {
    const best = contexts[0];
    const match = searchKnowledgeBase(message, 1)[0];
    const text = match ? getBotResponse(match.entry) : best.text.slice(0, 600);
    return {
      text,
      intent: "knowledge",
      mode: "keyword",
      sources: contexts.slice(0, 3).map((c) => ({ id: c.id, sheet: c.sheet })),
    };
  }

  const text = await generateReply(message, contexts);
  return {
    text,
    intent: "rag",
    mode: "llm",
    sources: contexts.slice(0, 3).map((c) => ({
      id: c.id,
      sheet: c.sheet,
      score: c.score ? Number(c.score.toFixed(3)) : undefined,
    })),
  };
}

async function chat(message) {
  const query = (message || "").trim();
  if (!query) {
    return { text: "Напишіть ваше питання — з радістю допоможу!", intent: "empty" };
  }

  if (isGreeting(query)) return handleGreeting();

  const tracking = handleTracking(query);
  if (tracking) return tracking;

  const calculator = handleCalculator(query);
  if (calculator) return calculator;

  const cabinet = handleCabinet(query);
  if (cabinet) return cabinet;

  try {
    return await chatWithRag(query);
  } catch (err) {
    console.error("[chat] RAG/LLM error:", err.message);
    const results = searchKnowledgeBase(query, 1);
    if (results[0]) {
      return {
        text: getBotResponse(results[0].entry),
        intent: "knowledge",
        mode: "keyword-fallback",
        error: err.message,
      };
    }
    return fallbackReply();
  }
}

module.exports = {
  loadKnowledgeBase,
  chat,
  searchKnowledgeBase,
};
