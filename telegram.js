/**
 * Отправка уведомления о заказе в Telegram.
 *
 * Базы нет: всё, что мы знаем о покупателе, лежит в metadata платежа
 * и приезжает сюда прямо из ответа ЮKassa.
 */

import { kopecksToDisplay } from './money.js';

const TELEGRAM_API = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 10000;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500; // 500 мс → 1 с → 2 с

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Экранирование для parse_mode: 'HTML'.
 * Telegram требует экранировать только эти три символа, но экранировать их
 * обязательно во ВСЕХ подставляемых значениях — иначе имя вида «<b>» сломает разметку.
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Дата и время по Москве — заказы принимаем в московском времени. */
function formatMoscowTime(isoString) {
    const date = isoString ? new Date(isoString) : new Date();
    const valid = Number.isNaN(date.getTime()) ? new Date() : date;

    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(valid).replace(',', '') + ' МСК';
}

/** Собирает текст сообщения из платежа ЮKassa. */
export function buildOrderMessage(payment) {
    const meta = payment?.metadata || {};

    const name = escapeHtml(meta.fullName || 'не указано');
    const phone = escapeHtml(meta.phone || '');
    const email = escapeHtml(meta.email || 'не указана');
    const itemsShort = escapeHtml(meta.itemsShort || 'состав заказа не передан');
    const paymentId = escapeHtml(payment?.id || 'неизвестен');

    // Сумма приходит от ЮKassa строкой «30000.00» — переводим в копейки и печатаем по-человечески
    const amountValue = payment?.amount?.value;
    const kopecks = amountValue ? Math.round(parseFloat(amountValue) * 100) : 0;
    const total = escapeHtml(kopecksToDisplay(kopecks));

    const divider = '━━━━━━━━━━━━━━';
    const lines = [
        '🛒 <b>Новый оплаченный заказ</b>',
        divider,
        `👤 <b>Имя:</b> ${name}`,
        phone
            ? `📞 <b>Телефон:</b> <a href="tel:${phone}">${phone}</a>`
            : '📞 <b>Телефон:</b> не указан',
        `✉️ <b>Почта:</b> ${email}`,
        meta.telegram
            ? `✈️ <b>Telegram:</b> <a href="https://t.me/${escapeHtml(meta.telegram)}">@${escapeHtml(meta.telegram)}</a>`
            : '✈️ <b>Telegram:</b> не указан',
        divider,
        `📦 <b>Заказ:</b> ${itemsShort}`,
    ];

    if (meta.comment) {
        lines.push(`💬 <b>Комментарий:</b> ${escapeHtml(meta.comment)}`);
    }

    lines.push(
        divider,
        `💰 <b>Итого:</b> ${total}`,
        `🆔 <code>${paymentId}</code>`,
        `🕒 ${escapeHtml(formatMoscowTime(payment?.captured_at || payment?.created_at))}`,
    );

    return lines.join('\n');
}

/**
 * Отправляет уведомление о заказе.
 * Три попытки с экспоненциальной задержкой на сетевой ошибке и на 429/5xx.
 * Кидает ошибку, если так и не удалось — вызывающий вебхук вернёт 500,
 * и ЮKassa повторит уведомление сама.
 */
export async function sendOrderNotification(payment) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        throw new Error('Не заданы TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID');
    }

    const body = {
        chat_id: chatId,
        text: buildOrderMessage(payment),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    };

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            if (response.ok) return true;

            const text = await response.text();

            // 429 и 5xx — временные, имеет смысл повторить.
            // 400 обычно означает сломанную разметку или неверный chat_id: повтор не поможет.
            if (response.status !== 429 && response.status < 500) {
                throw new Error(`Telegram отклонил сообщение: ${response.status} ${text.slice(0, 500)}`);
            }

            lastError = new Error(`Telegram вернул ${response.status}: ${text.slice(0, 500)}`);
        } catch (error) {
            if (error.message?.startsWith('Telegram отклонил')) throw error;
            lastError = error;
        }

        if (attempt < MAX_ATTEMPTS) {
            await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        }
    }

    throw lastError || new Error('Не удалось отправить уведомление в Telegram');
}
