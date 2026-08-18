/**
 * GET /api/payment-status?id=<paymentId>
 *
 * Нужен только для success.html: покупатель вернулся с ЮKassa, и надо понять,
 * благодарить его или отправлять на fail.html. ЮKassa возвращает на return_url
 * и после отмены, поэтому самому факту возврата верить нельзя.
 *
 * ЭТО НЕ ПОДТВЕРЖДЕНИЕ ЗАКАЗА. Заказ признаётся оплаченным только вебхуком
 * payment.succeeded — здесь мы лишь показываем покупателю правильный экран.
 *
 * Наружу отдаётся один enum-статус: ни сумм, ни metadata, ни данных покупателя.
 */

import { getPayment, YookassaError } from './_lib/yookassa.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Метод не поддерживается' });
    }

    const paymentId = req.query?.id;

    // id платежа в ЮKassa — UUID. Всё остальное до API не доводим.
    if (typeof paymentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(paymentId)) {
        return res.status(400).json({ error: 'Некорректный идентификатор платежа' });
    }

    try {
        const payment = await getPayment(paymentId);

        // succeeded — оплачен, pending — ещё в процессе, canceled — отменён
        const status = payment.status === 'succeeded' && payment.paid === true
            ? 'succeeded'
            : payment.status === 'canceled'
                ? 'canceled'
                : 'pending';

        // no-store: статус меняется, кэшировать его нельзя
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ status });
    } catch (error) {
        if (error instanceof YookassaError) {
            console.error('payment-status:', error.details || error.message);
            return res.status(error.statusCode).json({ error: 'Не удалось проверить статус платежа' });
        }
        console.error('payment-status: непредвиденная ошибка —', error);
        return res.status(500).json({ error: 'Не удалось проверить статус платежа' });
    }
}
