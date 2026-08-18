/**
 * Проверка настроек Telegram без запуска сайта и без оплаты.
 *
 * Запуск:  npm run check:telegram
 *
 * Что делает:
 *   1. проверяет, что токен рабочий, и показывает имя бота;
 *   2. отправляет в чат ТЕСТОВОЕ сообщение ровно того же вида,
 *      что придёт после настоящей оплаты — той же функцией из api/_lib/telegram.js.
 *
 * Никаких платежей это не создаёт. Файл можно удалить, когда всё настроено.
 */

import { sendOrderNotification } from '../api/_lib/telegram.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) {
    console.error('✗ В .env.local не заполнены TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID.');
    console.error('  Запускать через: npm run check:telegram');
    process.exit(1);
}

// --- 1. Токен рабочий? ---
let me;
try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    me = await response.json();
} catch (error) {
    console.error('✗ Нет связи с api.telegram.org:', error.message);
    process.exit(1);
}

if (!me.ok) {
    console.error(`✗ Токен не принят: ${me.description || 'ошибка'}`);
    console.error('  Проверьте TELEGRAM_BOT_TOKEN — он копируется целиком, вместе с частью до двоеточия.');
    process.exit(1);
}

console.log(`✓ Бот найден: @${me.result.username} (${me.result.first_name})`);
console.log(`  Отправляю тестовый заказ в чат ${chatId}...`);

// --- 2. Тестовое сообщение тем же кодом, что и в бою ---
const testPayment = {
    id: 'test-00000000-0000-0000-0000-000000000000',
    status: 'succeeded',
    paid: true,
    amount: { value: '30000.00', currency: 'RUB' },
    captured_at: new Date().toISOString(),
    metadata: {
        fullName: 'Тестовый Покупатель',
        phone: '+79991234567',
        email: 'test@example.com',
        telegram: 'vaultclub',
        comment: 'Это проверка настроек. Настоящего заказа не было.',
        itemsShort: 'Cardholder Vault (Белый) x2',
    },
};

try {
    await sendOrderNotification(testPayment);
    console.log('✓ Сообщение отправлено — проверьте чат.');
    console.log('');
    console.log('  Если сообщение пришло и выглядит правильно, Telegram настроен полностью.');
} catch (error) {
    console.error('✗ Отправить не удалось:', error.message);
    console.error('');
    if (/chat not found/i.test(error.message)) {
        console.error('  chat not found — неверный TELEGRAM_CHAT_ID.');
        console.error('  Для группы он отрицательный. Если группа стала супергруппой, id сменился на -100…');
    } else if (/bot is not a member|kicked|forbidden/i.test(error.message)) {
        console.error('  Бот не состоит в этом чате. Добавьте его в группу и повторите.');
    } else if (/not enough rights|CHAT_WRITE_FORBIDDEN/i.test(error.message)) {
        console.error('  У бота нет права писать в этот чат. В канале его нужно сделать администратором.');
    }
    process.exit(1);
}
