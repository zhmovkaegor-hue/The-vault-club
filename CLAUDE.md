# The Vault Club — интернет-магазин

## Товар
Один товар: **Cardholder Vault**, 15 000 ₽, цвет «Белый» (radio `#color-white`).
Структура допускает несколько цветов — при добавлении новых они станут отдельными SKU.

## Стек
Статический HTML + Tailwind Play CDN + ванильный JS в теге `<script>` внизу index.html.
Бэкенд — Vercel Serverless Functions в `/api`, Node.js 20, ES modules. Базы данных нет.
Никаких фреймворков и сборщиков. Никаких новых npm-зависимостей без явной просьбы.

## Дизайн-система (tailwind.config в index.html)
vault-bg #FDFBF7 · vault-accent #D85427 · vault-text #2A2626 · vault-line #EAE3DB
Шрифты: Playfair Display (serif, заголовки), Inter (sans, текст) — локально в assets/fonts.
Timing function `ease-premium`. Новые элементы делать в этой же стилистике,
не вводить новые цвета и не подключать сторонние UI-библиотеки.

## Платежи
ЮKassa API v3. Заказ считается оплаченным ТОЛЬКО по вебхуку `payment.succeeded`,
никогда по возврату на return_url.
Данные покупателя передаются через `metadata` платежа — базы нет.

## Правила, которые нельзя нарушать
- Цена только из `api/_lib/catalog.js`. Клиент присылает `{sku, qty}`, не цену.
- Деньги в коде — целые копейки. В ЮKassa — строка вида "15000.00".
- Каждый POST /v3/payments — со свежим `Idempotence-Key`.
- Секреты только через `process.env`, никогда в клиентском коде.
- Вебхук: проверка IP → перезапрос платежа по API → только потом Telegram.
- В корзине хранить `sku`, не base64-картинку.

## Важно про изображения
Картинки лежат файлами в `assets/img/*.webp`. НИКОГДА не вставляй base64-изображения
в HTML — исходная версия сайта весила 15 МБ именно из-за этого.

## Команды
npm run dev  → vercel dev (http://localhost:3000)
