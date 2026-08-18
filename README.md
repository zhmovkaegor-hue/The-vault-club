# The Vault Club

Одностраничный магазин одного товара. Статический HTML + Tailwind Play CDN + ванильный JS,
бэкенд — Vercel Serverless Functions на Node.js 20. Базы данных нет: данные покупателя
едут в `metadata` платежа ЮKassa и приезжают обратно в вебхук.

## Структура

```
index.html              витрина, корзина и форма оформления (весь JS внизу файла)
success.html            возврат с оплаты: проверяет статус, чистит корзину
fail.html               оплата не прошла, корзина сохраняется
privacy.html            политика перс. данных — заглушка с метками [[ЗАПОЛНИТЬ]]
offer.html              публичная оферта — заглушка с метками [[ЗАПОЛНИТЬ]]

assets/fonts.css        локальные @font-face, общие для всех страниц
assets/theme.js         tailwind.config, подключать ПОСЛЕ cdn.tailwindcss.com
assets/fonts/           woff2
assets/img/             webp (никаких base64 в HTML)

api/create-payment.js   POST: создать платёж, вернуть ссылку на оплату
api/yookassa-webhook.js POST: уведомление от ЮKassa → Telegram
api/payment-status.js   GET: статус платежа для success.html
api/_lib/catalog.js     ЕДИНСТВЕННОЕ место, где считаются деньги
api/_lib/validate.js    нормализация и проверка данных покупателя
api/_lib/yookassa.js    клиент ЮKassa API v3
api/_lib/telegram.js    сборка и отправка сообщения
api/_lib/money.js       копейки ↔ "15000.00" и «15 000 ₽»
```

## Локальный запуск

```bash
npm run dev
```

Поднимает `vercel dev` на http://localhost:3000 — статика и функции из `/api` вместе.
Перед первым запуском: `npm i -g vercel` и `vercel link`.

Переменные окружения — в `.env.local` (см. `.env.example`). `vercel dev` подхватывает его сам.
Можно вместо этого стянуть переменные из проекта: `vercel env pull .env.local`.

## Переменные окружения

| Переменная | Где используется | Примечание |
|---|---|---|
| `YOOKASSA_SHOP_ID` | `_lib/yookassa.js` | Магазин → Настройки → Ключи API |
| `YOOKASSA_SECRET_KEY` | `_lib/yookassa.js` | тестовый `test_…`, боевой `live_…` |
| `TELEGRAM_BOT_TOKEN` | `_lib/telegram.js` | от @BotFather |
| `TELEGRAM_CHAT_ID` | `_lib/telegram.js` | для группы/канала отрицательный |
| `SITE_URL` | `create-payment.js` | без слэша на конце, из него `return_url` |
| `SKIP_IP_CHECK` | `yookassa-webhook.js` | только локально, см. ниже |

В Vercel: **Settings → Environment Variables**. Для каждой переменной выбирается,
в каких окружениях она действует.

## Preview и Production

Vercel собирает **Production** из продакшн-ветки и **Preview** — из любой другой ветки
и из каждого пул-реквеста. У них разные домены и разные наборы переменных.

Практическая разница для этого проекта:

- **Preview** — тестовый магазин ЮKassa (`test_…`), `SITE_URL` = превью-домен,
  отдельный тестовый Telegram-чат, чтобы черновые заказы не сыпались в рабочий.
  Учтите: превью-домен у каждого деплоя свой, а `SITE_URL` один — если нужен
  точный `return_url`, задавайте переменную на конкретный деплой или используйте
  стабильный branch-домен вида `site-git-<branch>-<team>.vercel.app`.
- **Production** — боевые ключи (`live_…`), `SITE_URL` = ваш домен, рабочий чат.
  `NODE_ENV` здесь равен `production`, поэтому `SKIP_IP_CHECK` не действует
  даже если случайно выставлен.

Вебхук в личном кабинете ЮKassa настраивается **отдельно для тестового и боевого**
магазина: тестовый указывает на превью-домен, боевой — на прод.

## Настройка вебхука ЮKassa

В личном кабинете: **Настройки → Уведомления**, URL:

```
https://<ваш-домен>/api/yookassa-webhook
```

События: `payment.succeeded` и `payment.canceled`.

Вебхук принимает запросы только с IP-сетей ЮKassa. Список — константа
`YOOKASSA_IPV4_NETWORKS` в `api/yookassa-webhook.js`; **ЮKassa его периодически меняет**,
сверяйтесь с https://yookassa.ru/developers/using-api/webhooks

## Отладка вебхука локально через cloudflared

ЮKassa не достучится до `localhost`, нужен туннель.

1. Поставить cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
   (Windows: `winget install --id Cloudflare.cloudflared`)

2. Запустить сайт:

```bash
npm run dev
```

3. В другом терминале — туннель:

```bash
cloudflared tunnel --url http://localhost:3000
```

Выведет адрес вида `https://random-words-1234.trycloudflare.com`.

4. В `.env.local` выставить туннельный адрес и разрешить обход проверки IP —
   запросы придут с IP Cloudflare, а не ЮKassa:

```
SITE_URL=https://random-words-1234.trycloudflare.com
SKIP_IP_CHECK=1
```

Перезапустить `npm run dev`, чтобы переменные подхватились.

5. В тестовом магазине ЮKassa указать URL уведомлений:
   `https://random-words-1234.trycloudflare.com/api/yookassa-webhook`

> `SKIP_IP_CHECK` работает только когда `NODE_ENV != production`. На боевом деплое
> Vercel сам ставит `NODE_ENV=production`, так что обход там невозможен. В прод
> эту переменную всё равно не добавляйте.

Проверить вебхук без реальной оплаты можно и вручную:

```bash
curl -X POST http://localhost:3000/api/yookassa-webhook -H "Content-Type: application/json" -d "{\"event\":\"payment.succeeded\",\"object\":{\"id\":\"<id-реального-тестового-платежа>\"}}"
```

Тело всё равно перепроверяется запросом к API ЮKassa, поэтому нужен id настоящего платежа.

## Как считаются деньги

- В коде деньги — **целые копейки**. 15 000 ₽ это `1500000`.
- Цена берётся только из `api/_lib/catalog.js`. Клиент присылает `{sku, qty}` и ничего больше;
  любые присланные им `price`/`amount` игнорируются.
- В ЮKassa сумма уходит строкой `"15000.00"` (`_lib/money.js`).
- Каждый `POST /v3/payments` получает свежий `Idempotence-Key`.

## Как заказ признаётся оплаченным

Только по вебхуку `payment.succeeded`, и только после того, как платёж перезапрошен
через `GET /v3/payments/{id}` и у него `status === 'succeeded' && paid === true`.
Возврат покупателя на `success.html` ничего не подтверждает — эта страница лишь
показывает человеку правильный экран.

## Добавление нового цвета

Цвет = отдельный SKU. Нужно три правки:

1. `api/_lib/catalog.js` — запись в `CATALOG` с ценой в копейках.
2. `index.html`, объект `PRODUCTS` — название, цвет, путь к картинке, цена для витрины.
3. `index.html`, блок выбора цвета — `<input type="radio">` с `data-sku`, совпадающим с ключом каталога.

## Ограничения

- **Rate limit** в `create-payment.js` держится в памяти инстанса. На serverless
  инстансы независимы, так что это защита от залипшей кнопки, а не от перебора.
- **Защита от дублей** в вебхуке — тоже `Map` в памяти, теряется при холодном старте.
  ЮKassa при этом может прислать повтор и получить второе сообщение в Telegram.
  Обе проблемы решаются внешним хранилищем (Redis/Upstash) — в коде отмечено `TODO`.
- **Tailwind Play CDN** генерирует стили в браузере. Для продакшена стоит собрать
  статический CSS, чтобы убрать задержку отрисовки и внешний скрипт.
