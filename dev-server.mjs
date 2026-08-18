/**
 * Локальный сервер для проверки сайта без Vercel CLI и без аккаунта.
 *
 * Запуск:  npm run dev:local     → http://localhost:3000
 *
 * Отдаёт статику из корня проекта и выполняет функции из /api так же,
 * как это делает Vercel: те же handler(req, res), тот же req.body/req.query.
 *
 * Это ТОЛЬКО для локальной разработки. Боевой запуск — Vercel (см. README).
 */

import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
};

/** Собирает тело запроса и разбирает JSON, как это делает Vercel. */
function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve(undefined);
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve(raw); // обработчик сам решит, что делать с неразбираемым телом
            }
        });
    });
}

/** Обёртка ответа в стиле Vercel: res.status(200).json({...}) */
function decorateResponse(res) {
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (payload) => {
        if (!res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify(payload));
        return res;
    };
    res.send = (payload) => {
        res.end(payload);
        return res;
    };
    return res;
}

async function handleApi(req, res, url) {
    // /api/create-payment → api/create-payment.js
    const routePath = normalize(url.pathname.replace(/^\/+/, '')).replace(/\\/g, '/');
    const modulePath = join(ROOT, `${routePath}.js`);

    try {
        await access(modulePath);
    } catch {
        res.status(404).json({ error: `Функция ${routePath} не найдена` });
        return;
    }

    let handler;
    try {
        // Метка времени в импорте: правки в api/ подхватываются без перезапуска сервера
        const mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
        handler = mod.default;
    } catch (error) {
        console.error(`\n✗ Ошибка загрузки ${routePath}:\n`, error);
        res.status(500).json({ error: 'Ошибка загрузки функции, смотрите терминал' });
        return;
    }

    if (typeof handler !== 'function') {
        res.status(500).json({ error: `${routePath} не экспортирует handler по умолчанию` });
        return;
    }

    req.query = Object.fromEntries(url.searchParams);
    req.body = await readBody(req);

    try {
        await handler(req, decorateResponse(res));
    } catch (error) {
        console.error(`\n✗ Необработанная ошибка в ${routePath}:\n`, error);
        if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка, смотрите терминал' });
    }
}

async function handleStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Не выпускаем за пределы папки проекта
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('403');
    }

    try {
        const data = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store', // чтобы правки были видны сразу
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404</h1><p>Файл не найден. <a href="/">На главную</a></p>');
    }
}

createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
        console.log(`  ${req.method} ${url.pathname}`);
        await handleApi(req, res, url);
    } else {
        await handleStatic(req, res, url);
    }
}).listen(PORT, () => {
    const hasYookassa = Boolean(process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY);
    const hasTelegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

    console.log('');
    console.log(`  Сайт:     http://localhost:${PORT}`);
    console.log(`  ЮKassa:   ${hasYookassa ? 'ключи заданы' : 'ключей нет — оплата вернёт «Платежи временно недоступны»'}`);
    console.log(`  Telegram: ${hasTelegram ? 'настроен' : 'не настроен'}`);
    console.log('');
    console.log('  Остановить: Ctrl+C');
    console.log('');
});
