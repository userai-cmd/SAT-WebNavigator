const fs = require("fs");
const path = require("path");

const KB_PATH = path.join(__dirname, "../data/knowledge-base.json");

let cache = null;

function loadKnowledgeBase() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
  }
  return cache;
}

const TRACKING_NUMBER_RE = /\b\d{10,20}\b/;

const QUICK_ACTIONS = [
  { label: "Послуги SAT", keywords: ["послуг", "доставк", "вантаж", "посилк"] },
  { label: "Тарифи", keywords: ["тариф", "ціна", "вартість", "коштує", "скільки"] },
  { label: "Трекінг", keywords: ["відстеж", "трекінг", "де вантаж", "статус", "накладн"] },
  { label: "Відділення", keywords: ["відділен", "адрес", "де забрати", "склад"] },
  { label: "Особистий кабінет", keywords: ["кабінет", "реєстрац", "увійти", "логін"] },
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text).split(" ").filter((w) => w.length > 2);
}

function scoreEntry(queryTokens, entry) {
  const keywords = entry["Ключові слова"] || "";
  const question = entry["Питання"] || entry["Послуга"] || entry["Тема"] || entry["Ситуація"] || entry["Категорія"] || "";
  const haystack = normalize(
    [keywords, question, entry["Опис"] || "", entry["Параметри"] || "", entry["Правило / Умова"] || ""].join(" ")
  );
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 2;
  }
  const q = normalize(queryTokens.join(" "));
  if (keywords && q) {
    for (const kw of keywords.split(",")) {
      const k = normalize(kw);
      if (k && q.includes(k)) score += 5;
    }
  }
  return score;
}

function getBotResponse(entry) {
  return (
    entry["Відповідь бота"] ||
    entry["Шаблон фрази (UA)"] ||
    entry["Значення"] ||
    entry["Опис"] ||
    null
  );
}

function searchKnowledgeBase(query, limit = 3) {
  const kb = loadKnowledgeBase();
  const tokens = tokenize(query);
  const scored = [];

  for (const sheet of kb.sheets) {
    for (const entry of sheet.entries) {
      const score = scoreEntry(tokens, entry);
      if (score > 0) {
        scored.push({ score, entry, sheet: sheet.id });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
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
      links: [{ label: "Відстежити на sat.ua", url: `https://sat.ua/tracking` }],
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

function chat(message) {
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

  const results = searchKnowledgeBase(query, 3);
  if (results.length > 0 && results[0].score >= 2) {
    const best = results[0];
    const response = getBotResponse(best.entry);
    return {
      text: response,
      intent: "knowledge",
      source: { sheet: best.sheet, id: best.entry.ID || best.entry.Параметр },
      confidence: best.score,
    };
  }

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

module.exports = {
  loadKnowledgeBase,
  chat,
  searchKnowledgeBase,
};
