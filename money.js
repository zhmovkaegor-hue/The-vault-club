/**
 * Преобразования денег на границе системы.
 *
 * Внутри бэкенда деньги всегда целые копейки.
 * Наружу они уходят в двух видах:
 *   - в ЮKassa строкой "15000.00";
 *   - в Telegram человекочитаемо «15 000 ₽».
 */

/**
 * Копейки → строка суммы для API ЮKassa: ровно два знака после точки.
 * 1500000 → "15000.00", 1 → "0.01"
 */
export function kopecksToYookassaAmount(kopecks) {
    if (!Number.isInteger(kopecks) || kopecks < 0) {
        throw new Error(`Сумма должна быть целым числом копеек, получено: ${kopecks}`);
    }
    const rubles = Math.floor(kopecks / 100);
    const remainder = kopecks % 100;
    return `${rubles}.${String(remainder).padStart(2, '0')}`;
}

/**
 * Копейки → строка для человека: «15 000 ₽», «15 000,50 ₽».
 * Пробел неразрывный, чтобы сумма не переносилась в сообщении Telegram.
 */
export function kopecksToDisplay(kopecks) {
    const rubles = Math.floor(kopecks / 100);
    const remainder = kopecks % 100;
    const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    const tail = remainder > 0 ? `,${String(remainder).padStart(2, '0')}` : '';
    return `${grouped}${tail}\u00A0₽`;
}
