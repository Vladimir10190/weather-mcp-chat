import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { configureModel, createPlanner } from './model.mjs';
import { createWeatherAgent, defaultMcpUrl, periods } from './weather.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/clouds.png', ['clouds.png', 'image/png']],
]);

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readQuestion(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error('Запрос слишком длинный.');
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  if (!question || question.length > 500) throw new Error('Введите вопрос длиной до 500 символов.');
  const { city, period } = payload.previous ?? {};
  const previous = typeof city === 'string' && city.length <= 150 && periods.includes(period)
    ? { city, period }
    : null;
  return { question, previous };
}

export function makeServer(plan, model, url = defaultMcpUrl) {
  const ask = createWeatherAgent(plan, url);
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [file, contentType] = assets.get(path);
        const body = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(body);
        return;
      }
      if (req.method === 'GET' && path === '/api/config') {
        json(res, 200, { mcpUrl: url, model });
        return;
      }
      if (req.method !== 'POST' || path !== '/api/chat') {
        json(res, 404, { error: 'Страница не найдена.' });
        return;
      }

      let input;
      try {
        input = await readQuestion(req);
      } catch {
        json(res, 400, { error: 'Введите вопрос длиной до 500 символов.' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      const send = (type, payload) => {
        if (!res.destroyed) res.write(`${JSON.stringify({ type, ...payload })}\n`);
      };
      send('start', {});
      try {
        const result = await ask(input.question, input.previous, entry => send('trace', entry));
        send('answer', result);
      } catch (error) {
        console.error(error);
        send('answer', { answer: 'Не удалось обработать запрос. Попробуйте ещё раз.', error: 'internal_error' });
      }
      res.end();
    } catch (error) {
      console.error(error);
      if (res.headersSent) res.end();
      else json(res, 500, { error: 'Ошибка приложения.' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config;
  try {
    config = configureModel();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3049);
  const server = makeServer(createPlanner(config), config.model, process.env.WEATHER_MCP_URL);
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE'
      ? `Порт ${port} занят. Укажите свободный порт в .env.`
      : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Погодный чат: http://127.0.0.1:${server.address().port}`);
  });
}
