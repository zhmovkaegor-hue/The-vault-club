/**
 * Тонкий клиент ЮKassa API v3. Только встроенный fetch и node:crypto.
 *
 * Секреты берутся из process.env в момент вызова, а не при импорте модуля:
 * иначе функция падала бы ещё на старте, если переменные не выставлены.
 */

import { randomUUID } from 'node:crypto';

const API_BASE = 'https://api.yookassa.ru/v3';
const REQUEST_TIMEOUT_MS = 15000;

/** Ошибка обращения к ЮKassa. Наружу отдаём безопасный текст, детали пишем в лог. */
export class YookassaError extends Error {
    constructor(message, { statusCode = 502, details = null } = {}) {
        super(message);
        this.name = 'YookassaError';
        this.statusCode = statusCode;
        this.details = details;
    }
}

function getCredentials() {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;

    if (!shopId || !secretKey) {
        throw new YookassaError('Платежи временно недоступны', {
            statusCode: 500,
            details: 'Не заданы YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY',
        });
    }

    return `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;
}

async function request(path, { method = 'GET', body = null, idempotenceKey = null } = {}) {
    const headers = {
        Authorization: getCredentials(),
        Accept: 'application/json',
    };

    if (body) headers['Content-Type'] = 'application/json';
    // Idempotence-Key обязателен для всех небезопасных методов: при повторе запроса
    // с тем же ключом ЮKassa вернёт тот же платёж, а не создаст второй.
    if (idempotenceKey) headers['Idempotence-Key'] = idempotenceKey;

    let response;
    try {
        response = await fetch(`${API_BASE}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw new YookassaError('Платёжный сервис не отвечает, попробуйте ещё раз', {
            statusCode: 504,
            details: `${method} ${path}: ${error.name} ${error.message}`,
        });
    }

    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }

    if (!response.ok) {
        throw new YookassaError('Не удалось создать платёж, попробуйте ещё раз', {
            // 4xx от ЮKassa — почти всегда наша ошибка в теле запроса, наружу это 502
            statusCode: response.status === 429 ? 429 : 502,
            details: `${method} ${path} → ${response.status} ${text.slice(0, 1000)}`,
        });
    }

    if (!payload) {
        throw new YookassaError('Платёжный сервис вернул неожиданный ответ', {
            statusCode: 502,
            details: `${method} ${path} → пустой или неразбираемый ответ`,
        });
    }

    return payload;
}

/**
 * Создаёт платёж. Каждый вызов получает свежий Idempotence-Key:
 * это разные попытки оплаты, склеивать их нельзя.
 */
export function createPayment(payload) {
    return request('/payments', {
        method: 'POST',
        body: payload,
        idempotenceKey: randomUUID(),
    });
}

/** Перезапрашивает платёж по id. Единственный источник правды о статусе оплаты. */
export function getPayment(paymentId) {
    return request(`/payments/${encodeURIComponent(paymentId)}`);
}
