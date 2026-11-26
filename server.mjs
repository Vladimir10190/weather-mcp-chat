import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assets, chatHeaders, readQuestion, runChat } from './chat.mjs';
import { configureModel, createPlanner } from './model.mjs';
import { createWeatherAgent, defaultMcpUrl } from './weather.mjs';

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
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

      res.writeHead(200, chatHeaders);
      await runChat(ask, input, line => {
        if (!res.destroyed) res.write(line);
      });
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
