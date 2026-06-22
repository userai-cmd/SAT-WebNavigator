# SAT WebNavigator

AI-чат віджет для [sat.ua](https://sat.ua) на базі `SAT_Bot_Knowledge_Base_v4.xlsx`.

## Структура

```
├── data/knowledge-base.json   # база знань (з Excel)
├── scripts/import-excel.py    # конвертація Excel → JSON
├── server/                    # Express API
├── widget/                    # JS-віджет для вбудовування
└── public/                    # тестова сторінка
```

## Локальний запуск

```bash
npm install
cp .env.example .env   # додайте OPENAI_API_KEY
npm run import         # оновити базу з Excel
npm run build:embeddings   # побудувати RAG-індекс (один раз)
npm start              # http://localhost:3000
```

## LLM + RAG

Бот використовує **OpenAI**:
- **gpt-4o-mini** — генерація відповідей
- **text-embedding-3-small** — пошук по базі знань (RAG)

Змінні середовища (Railway → Variables):

```
OPENAI_API_KEY=sk-...
ALLOWED_ORIGINS=https://sat.ua,https://www.sat.ua
```

Без `OPENAI_API_KEY` працює лише пошук по ключових словах (старий режим).

Перевірка: `GET /health` → `rag.enabled`, `llm.enabled`, `rag.chunkCount`

Відкрийте http://localhost:3000 — тестова сторінка з віджетом.

## API

### `POST /api/chat`

```json
{ "message": "Скільки коштує доставка?" }
```

### `GET /health`

Статус сервісу та кількість записів у базі.

## Вбудовування на sat.ua

```html
<script>
  window.SAT_WIDGET_API = "https://your-app.railway.app";
</script>
<script src="https://your-app.railway.app/widget/widget.js"></script>
```

## Деплой на Railway

1. Створіть репозиторій на GitHub і запуште проєкт
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Railway автоматично виконає `npm start`
4. Змінна `ALLOWED_ORIGINS` (опційно): `https://sat.ua,https://www.sat.ua`

## Оновлення бази знань

1. Замініть `SAT_Bot_Knowledge_Base_v4.xlsx`
2. `npm run import`
3. Перезапустіть сервер / redeploy

## Наступні кроки

- [ ] Підключення OpenAI для RAG + природні відповіді
- [ ] API SAT: трекінг (`sat.ua/tracking`) та калькулятор (`api.sat.ua`)
- [ ] Ескалація на оператора
