/**
 * POST /api/yookassa-webhook
 *
 * Единственное место, где заказ признаётся оплаченным.
 * Порядок строгий и менять его нельзя:
 *   1. проверить IP отправителя;
 *   2. разобрать тело;
 *   3. перезапросить платёж у ЮKassa и поверить только её ответу;
 *   4. отправить в Telegram;
 *   5. ответить 200.
 */

import { getPayment } from './_lib/yookassa.js';
import { sendOrderNotification } from './_lib/telegram.js';

/* --- Сети, с которых ЮKassa шлёт уведомления ---
   СВЕРЯТЬ С ДОКУМЕНТАЦИЕЙ ЮKASSA, СПИСОК МЕНЯЕТСЯ:
   https://yookassa.ru/developers/using-api/webhooks
   При расширении списка достаточно дописать строку сюда. */
const YOOKASSA_IPV4_NETWORKS = [
    '185.71.76.0/27',
    '185.71.77.0/27',
    '77.75.153.0/25',
    '77.75.154.128/25',
    '77.75.156.11',      // одиночный адрес, маска /32 подразумевается
    '77.75.156.35',
];

// IPv6-сеть ЮKassa. Полноценную арифметику IPv6 не разворачиваем:
// проверяем принадлежность префиксу /32 сравнением первых двух групп.
const YOOKASSA_IPV6_PREFIX = '2a02:5180:';

/** '192.168.0.1' → целое без знака, или null если это не IPv4. */
function ipv4ToInt(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        result = result * 256 + octet;
    }
    return result >>> 0;
}

/** Проверка вхождения IPv4 в сеть вида '185.71.76.0/27' или в одиночный адрес. */
function isIpv4InNetwork(ip, network) {
    const [range, bitsRaw] = network.split('/');
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);

    const ipInt = ipv4ToInt(ip);
    const rangeInt = ipv4ToInt(range);
    if (ipInt === null || rangeInt === null) return false;
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;

    // Маска из старших bits единиц: для /27 это 255.255.255.224
    const mask = (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (ipInt & mask) === (rangeInt & mask);
}

function isYookassaIp(ip) {
    if (!ip) return false;

    // Vercel может отдать IPv4 в виде ::ffff:185.71.76.5
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

    if (normalized.includes(':')) {
        return normalized.toLowerCase().startsWith(YOOKASSA_IPV6_PREFIX);
    }

    return YOOKASSA_IPV4_NETWORKS.some(network => isIpv4InNetwork(normalized, network));
}

/** Первый адрес из x-forwarded-for — это отправитель, остальные добавляют прокси. */
function getSenderIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || '';
}

/* --- Защита от повторной обработки ---
   ЮKassa повторяет уведомление, пока не получит 200, поэтому один и тот же
   payment_id приходит по несколько раз. Set живёт в памяти инстанса и теряется
   при холодном старте — этого хватает, чтобы не задваивать сообщения в пределах
   одной серии ретраев.
   TODO: вынести в Redis/Upstash, когда появится внешнее хранилище, — тогда защита
   переживёт перезапуск инстанса и будет общей для всех инстансов сразу. */
const processedPayments = new Map(); // paymentId → 'processing' | 'done'
const PROCESSED_LIMIT = 1000;

function rememberPayment(paymentId, state) {
    if (processedPayments.size > PROCESSED_LIMIT) {
        // Простейшая эвикция: выкидываем самые старые ключи
        const excess = processedPayments.size - PROCESSED_LIMIT;
        let removed = 0;
        for (const key of processedPayments.keys()) {
            processedPayments.delete(key);
            if (++removed >= excess) break;
        }
    }
    processedPayments.set(paymentId, state);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    /* --- 1. Проверка IP отправителя --- */
    const senderIp = getSenderIp(req);

    // Локальная отладка через туннель: в проде эта лазейка закрыта наглухо
    const skipIpCheck = process.env.SKIP_IP_CHECK === '1' && process.env.NODE_ENV !== 'production';

    if (!skipIpCheck && !isYookassaIp(senderIp)) {
        console.error('webhook: запрос с постороннего IP —', senderIp);
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        /* --- 2. Разбор тела --- */
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        const event = body?.event;
        const paymentId = body?.object?.id;

        if (!event || !paymentId) {
            console.error('webhook: тело без event или object.id');
            return res.status(400).json({ error: 'Bad Request' });
        }

        if (event !== 'payment.succeeded' && event !== 'payment.canceled') {
            // Прочие события нам не интересны, но 200 вернуть надо — иначе ЮKassa будет ретраить
            return res.status(200).json({ ok: true });
        }

        const alreadyHandled = processedPayments.get(paymentId);
        if (alreadyHandled === 'done' || alreadyHandled === 'processing') {
            return res.status(200).json({ ok: true, duplicate: true });
        }
        rememberPayment(paymentId, 'processing');

        /* --- 3. Телу не верим: перезапрашиваем платёж у ЮKassa --- */
        let payment;
        try {
            payment = await getPayment(paymentId);
        } catch (error) {
            processedPayments.delete(paymentId); // дадим ЮKassa повторить
            console.error('webhook: не удалось перезапросить платёж', paymentId, error.details || error.message);
            return res.status(500).json({ error: 'Payment fetch failed' });
        }

        if (payment.status !== 'succeeded' || payment.paid !== true) {
            // Отмена или ещё не оплачено: уведомлять продавца не о чем.
            console.log(`webhook: платёж ${paymentId} со статусом ${payment.status}, paid=${payment.paid} — пропускаем`);
            rememberPayment(paymentId, 'done');
            return res.status(200).json({ ok: true });
        }

        /* --- 4. Telegram --- */
        try {
            await sendOrderNotification(payment);
        } catch (error) {
            // Не смогли уведомить — отдаём 500, чтобы ЮKassa прислала уведомление ещё раз.
            // Заказ уже оплачен, потерять его нельзя.
            processedPayments.delete(paymentId);
            console.error('webhook: Telegram не принял сообщение по платежу', paymentId, error.message);
            return res.status(500).json({ error: 'Notification failed' });
        }

        /* --- 5. Только теперь 200 --- */
        rememberPayment(paymentId, 'done');
        console.log('webhook: заказ обработан, платёж', paymentId);
        return res.status(200).json({ ok: true });
    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error('webhook: тело не разбирается как JSON');
            return res.status(400).json({ error: 'Bad Request' });
        }
        console.error('webhook: непредвиденная ошибка —', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
