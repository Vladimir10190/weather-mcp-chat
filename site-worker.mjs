import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { assets, chatHeaders, readQuestion, runChat } from './chat.mjs';
import { configureModel, createPlanner } from './model.mjs';
import { createWeatherAgent, defaultMcpUrl } from './weather.mjs';
import cover from './public/clouds.png';

const assetBodies = { ...SITE_TEXT_ASSETS, 'clouds.png': cover };
const jsonHeaders = { 'Cache-Control': 'no-store' };

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && assets.has(path)) {
      const [file, type] = assets.get(path);
      return new Response(assetBodies[file], { headers: { 'Content-Type': type } });
    }
    if (request.method === 'GET' && path === '/api/config') {
      return Response.json({
        mcpUrl: defaultMcpUrl,
        model: env.WEATHER_MODEL || 'google/gemini-3.1-flash-lite',
      }, { headers: jsonHeaders });
    }
    if (request.method !== 'POST' || path !== '/api/chat') {
      return Response.json({ error: 'Страница не найдена.' }, { status: 404, headers: jsonHeaders });
    }
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
      return Response.json({ error: 'Ожидается JSON.' }, { status: 415, headers: jsonHeaders });
    }
    if (!env.VSELLM_API_KEY) {
      console.error('Для сайта не задан секрет VSELLM_API_KEY.');
      return Response.json({ error: 'Провайдер модели не настроен.' }, { status: 503, headers: jsonHeaders });
    }

    let input;
    try {
      input = await readQuestion(request.body);
    } catch {
      return Response.json({ error: 'Введите вопрос длиной до 500 символов.' }, { status: 400, headers: jsonHeaders });
    }
    const config = configureModel({
      OPENAI_API_KEY: env.VSELLM_API_KEY,
      WEATHER_MODEL: env.WEATHER_MODEL,
    });
    const ask = createWeatherAgent(createPlanner(config), defaultMcpUrl, new CfWorkerJsonSchemaValidator());
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        void runChat(ask, input, line => {
          if (!cancelled) controller.enqueue(encoder.encode(line));
        }).finally(() => {
          if (!cancelled) controller.close();
        });
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, { headers: chatHeaders });
  },
};
