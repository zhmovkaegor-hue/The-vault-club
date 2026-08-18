/**
 * Источник правды по ценам.
 *
 * Все суммы здесь и во всём бэкенде — ЦЕЛЫЕ КОПЕЙКИ.
 * Дробных рублей в расчётах не существует: копейки складываем и умножаем
 * как обычные целые числа, в строку "15000.00" превращаем только на границе
 * с ЮKassa (см. api/_lib/money.js).
 *
 * Клиент присылает только { sku, qty }. Цену он не присылает никогда.
 */

export const CATALOG = {
    'cardholder-vault-white': {
        title: 'Cardholder Vault — Белый',
        price: 1500000,        // 15 000,00 ₽
        vatCode: 1,            // «без НДС». При ОСН с НДС 20% здесь должно быть 4.
    },
};

// Границы количества одной позиции и числа позиций в заказе
export const MAX_QTY_PER_ITEM = 99;
export const MAX_ITEMS_IN_ORDER = 20;

/**
 * Ошибка бизнес-валидации заказа. Отдаётся клиенту как 400 с понятным текстом,
 * в отличие от неожиданных ошибок, которые превращаются в 500.
 */
export class OrderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'OrderError';
        this.statusCode = 400;
    }
}

/**
 * Проверяет позиции заказа и считает суммы.
 * Единственное место, где считаются деньги.
 *
 * @param {Array<{sku: string, qty: number}>} items — то, что прислал клиент
 * @returns {{
 *   items: Array<{sku: string, title: string, qty: number, unitPrice: number, lineTotal: number, vatCode: number}>,
 *   totalAmount: number,   // копейки
 *   totalQty: number
 * }}
 * @throws {OrderError} с понятным текстом при любой некорректности
 */
export function resolveOrder(items) {
    if (!Array.isArray(items) || items.length === 0) {
        throw new OrderError('Корзина пуста');
    }
    if (items.length > MAX_ITEMS_IN_ORDER) {
        throw new OrderError(`В заказе не может быть больше ${MAX_ITEMS_IN_ORDER} позиций`);
    }

    const seen = new Set();
    const resolved = [];
    let totalAmount = 0;
    let totalQty = 0;

    for (const raw of items) {
        if (!raw || typeof raw !== 'object') {
            throw new OrderError('Некорректная позиция в заказе');
        }

        const { sku, qty } = raw;

        if (typeof sku !== 'string' || !Object.prototype.hasOwnProperty.call(CATALOG, sku)) {
            throw new OrderError('Товар не найден');
        }
        // Дубли одного sku схлопывать не будем — это признак кривого клиента
        if (seen.has(sku)) {
            throw new OrderError('Позиция встречается в заказе дважды');
        }
        seen.add(sku);

        // qty должно быть именно целым числом, а не строкой и не 2.5
        if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
            throw new OrderError(`Количество должно быть целым числом от 1 до ${MAX_QTY_PER_ITEM}`);
        }

        const product = CATALOG[sku];
        const lineTotal = product.price * qty; // копейки × целое = копейки

        resolved.push({
            sku,
            title: product.title,
            qty,
            unitPrice: product.price,
            lineTotal,
            vatCode: product.vatCode,
        });

        totalAmount += lineTotal;
        totalQty += qty;
    }

    if (totalAmount <= 0) {
        throw new OrderError('Некорректная сумма заказа');
    }

    return { items: resolved, totalAmount, totalQty };
}
