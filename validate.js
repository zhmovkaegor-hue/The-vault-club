/**
 * Валидация и нормализация входящего заказа. Без внешних библиотек.
 *
 * Всё, что приходит от клиента, считается враждебным: строки режутся по длине,
 * управляющие символы вырезаются, телефон приводится к единому виду,
 * а суммы вообще не принимаются — их считает resolveOrder по каталогу.
 */

import { resolveOrder, OrderError } from './catalog.js';

export { OrderError };

/** Ошибка валидации входных данных — всегда 400 с понятным текстом для покупателя. */
export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = 400;
    }
}

// Управляющие символы вырезаем, чтобы они не ломали разметку сообщения в Telegram.
// В имени и почте — все до единого, в комментарии оставляем перевод строки.
const CONTROL_CHARS_ALL = /[\u0000-\u001F\u007F]/g;
const CONTROL_CHARS_KEEP_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEGRAM_RE = /^[A-Za-z0-9_]{5,32}$/;

const MAX_COMMENT_LENGTH = 500;

/** Приводит значение к строке и вычищает управляющие символы. */
function toCleanString(value, { allowNewline = false } = {}) {
    if (typeof value !== 'string') return '';
    const pattern = allowNewline ? CONTROL_CHARS_KEEP_NEWLINE : CONTROL_CHARS_ALL;
    return value.replace(pattern, '');
}

/**
 * Телефон → +7XXXXXXXXXX.
 * Принимает 8XXXXXXXXXX, +7XXXXXXXXXX, 7XXXXXXXXXX, десять цифр без кода,
 * с любыми пробелами, скобками и дефисами.
 */
export function normalizePhone(value) {
    const digits = toCleanString(value).replace(/\D/g, '');

    let national;
    if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
        national = digits.slice(1);
    } else if (digits.length === 10) {
        national = digits;
    } else {
        throw new ValidationError('Проверьте номер телефона');
    }

    if (!/^[1-9]\d{9}$/.test(national)) {
        throw new ValidationError('Проверьте номер телефона');
    }

    return `+7${national}`;
}

/**
 * Telegram → голый username без @ и без t.me/.
 * Если после нормализации ник не подходит под формат — возвращаем пустую строку:
 * поле необязательное, из-за него заказ не разворачиваем.
 */
export function normalizeTelegram(value) {
    const raw = toCleanString(value).trim();
    if (!raw) return '';

    const username = raw
        .replace(/^https?:\/\//i, '')
        .replace(/^t\.me\//i, '')
        .replace(/^@/, '')
        .trim();

    return TELEGRAM_RE.test(username) ? username : '';
}

/** Имя: схлопываем пробелы, режем по длине. */
function normalizeFullName(value) {
    const name = toCleanString(value).replace(/\s+/g, ' ').trim();

    if (name.length < 2 || name.length > 100) {
        throw new ValidationError('Укажите имя — от 2 до 100 символов');
    }
    return name;
}

function normalizeEmail(value) {
    const email = toCleanString(value).trim();

    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
        throw new ValidationError('Проверьте адрес почты');
    }
    return email;
}

/** Комментарий: перевод строки разрешён, длина обрезается молча. */
function normalizeComment(value) {
    const comment = toCleanString(value, { allowNewline: true })
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return comment.slice(0, MAX_COMMENT_LENGTH);
}

/**
 * Разбирает и проверяет тело запроса на создание платежа.
 *
 * @param {unknown} body
 * @returns {{
 *   order: ReturnType<typeof resolveOrder>,
 *   customer: {fullName: string, phone: string, email: string, telegram: string},
 *   comment: string
 * }}
 * @throws {ValidationError|OrderError} — обе с statusCode 400
 */
export function validateOrderRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Некорректный запрос');
    }

    const { items, customer, comment, consent } = body;

    // Согласие на обработку персональных данных обязательно и именно булево true
    if (consent !== true) {
        throw new ValidationError('Нужно согласие на обработку персональных данных');
    }

    if (!customer || typeof customer !== 'object' || Array.isArray(customer)) {
        throw new ValidationError('Не заполнены данные покупателя');
    }

    // Проверка позиций и подсчёт сумм — целиком в resolveOrder, чтобы деньги
    // считались ровно в одном месте. Бросает OrderError, тоже 400.
    const order = resolveOrder(items);

    return {
        order,
        customer: {
            fullName: normalizeFullName(customer.fullName),
            phone: normalizePhone(customer.phone),
            email: normalizeEmail(customer.email),
            telegram: normalizeTelegram(customer.telegram),
        },
        comment: normalizeComment(comment),
    };
}
