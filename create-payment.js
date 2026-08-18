/**
 * POST /api/create-payment
 *
 * Принимает { items: [{sku, qty}], customer, comment, consent },
 * создаёт платёж в ЮKassa и возвращает { confirmationUrl, paymentId }.
 *
 * Клиент НЕ присылает цены: сумма считается заново из api/_lib/catalog.js.
 * Заказ считается оплаченным только по вебхуку payment.succeeded,
 * возврат покупателя на return_url ничего не подтверждает.
 */

import { validateOrderRequest, ValidationError, OrderError } from './_lib/validate.js';
import { createPayment, YookassaError } from './_lib/yookassa.js';
import { kopecksToYookassaAmount } from './_lib/money.js';

// Ограничения ЮKassa на длину полей
const MAX_DESCRIPTION_LENGTH = 128;
const MAX_ITEMS_SHORT_LENGTH = 480;

/* --- Мягкий rate limit по IP ---
   ВАЖНО: Map живёт в памяти одного инстанса функции. На serverless инстансы
   поднимаются и умирают независимо, поэтому это лишь частичная защита от
   случайного залипания кнопки, а не от целенаправленного перебора.
   Для настоящего лимита нужен внешний счётчик (Redis/Upstash). */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitHits = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const hits = (rateLimitHits.get(ip) || []).filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    hits.push(now);
    rateLimitHits.set(ip, hits);

    // Подчищаем чужие протухшие записи, чтобы Map не рос бесконечно
    if (rateLimitHits.size > 500) {
        for (const [key, timestamps] of rateLimitHits) {
            if (timestamps.every(ts => now - ts >= RATE_LIMIT_WINDOW_MS)) {
                rateLimitHits.delete(key);
            }
        }
    }

    return hits.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

/** 'Cardholder Vault — Белый' → 'Cardholder Vault (Белый)' для короткой сводки */
function shortTitle(title) {
    return title.replace(/\s+—\s+(.+)$/, ' ($1)');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    if (isRateLimited(getClientIp(req))) {
        return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
    }

    try {
        // Vercel разбирает JSON сам, но подстрахуемся, если тело пришло строкой
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        const { order, customer, comment } = validateOrderRequest(body);

        const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
        if (!siteUrl) {
            console.error('create-payment: не задан SITE_URL');
            return res.status(500).json({ error: 'Платежи временно недоступны' });
        }

        // Компактная сводка заказа: «Cardholder Vault (Белый) x2»
        const itemsShort = order.items
            .map(item => `${shortTitle(item.title)} x${item.qty}`)
            .join(', ')
            .slice(0, MAX_ITEMS_SHORT_LENGTH);

        const description = `Заказ The Vault Club: ${itemsShort}`.slice(0, MAX_DESCRIPTION_LENGTH);

        const payment = await createPayment({
            // Сумма — из resolveOrder, копейки превращаются в строку "15000.00"
            amount: {
                value: kopecksToYookassaAmount(order.totalAmount),
                currency: 'RUB',
            },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: `${siteUrl}/success.html`,
            },
            description,
            receipt: {
                customer: {
                    full_name: customer.fullName,
                    email: customer.email,
                    phone: customer.phone,
                },
                items: order.items.map(item => ({
                    description: item.title.slice(0, MAX_DESCRIPTION_LENGTH),
                    quantity: String(item.qty),
                    amount: {
                        // В чеке — цена за единицу, ЮKassa сама умножит на quantity
                        value: kopecksToYookassaAmount(item.unitPrice),
                        currency: 'RUB',
                    },
                    vat_code: item.vatCode,
                    payment_subject: 'commodity',
                    payment_mode: 'full_prepayment',
                })),
            },
            // Базы нет: данные покупателя едут вместе с платежом и приезжают обратно в вебхук
            metadata: {
                fullName: customer.fullName,
                phone: customer.phone,
                email: customer.email,
                telegram: customer.telegram,
                comment,
                itemsShort,
            },
        });

        const confirmationUrl = payment?.confirmation?.confirmation_url;
        if (!confirmationUrl) {
            console.error('create-payment: ЮKassa не вернула confirmation_url', payment?.id);
            return res.status(502).json({ error: 'Не удалось создать платёж. Попробуйте ещё раз.' });
        }

        // Наружу отдаём только это: ни сумм, ни статусов, ни содержимого metadata
        return res.status(200).json({
            confirmationUrl,
            paymentId: payment.id,
        });
    } catch (error) {
        if (error instanceof ValidationError || error instanceof OrderError) {
            // Ожидаемые ошибки ввода — текст можно показать покупателю как есть
            return res.status(error.statusCode).json({ error: error.message });
        }

        if (error instanceof YookassaError) {
            console.error('create-payment: ошибка ЮKassa —', error.details || error.message);
            return res.status(error.statusCode).json({ error: error.message });
        }

        if (error instanceof SyntaxError) {
            return res.status(400).json({ error: 'Некорректный запрос' });
        }

        console.error('create-payment: непредвиденная ошибка —', error);
        return res.status(500).json({ error: 'Что-то пошло не так. Попробуйте ещё раз.' });
    }
}
