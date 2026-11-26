export function configureModel(env = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Укажите OPENAI_API_KEY в .env. Пример настроек находится в .env.example.');
  const baseUrl = (env.OPENAI_BASE_URL || 'https://api.vsellm.ru/v1').replace(/\/+$/, '');
  const model = env.WEATHER_MODEL || 'google/gemini-3.1-flash-lite';
  return { apiKey, endpoint: `${baseUrl}/chat/completions`, model };
}

const system = `Вы планируете вызовы инструментов погодного чата.
Верните JSON с городом (city), периодом (period) и последовательностью имён выбранных инструментов (tools).
Пишите название города в именительном падеже, сохраняя язык запроса.
В коротком уточнении «А в …?» возьмите новый город из вопроса и период из предыдущего запроса.
В коротком уточнении «А завтра?» возьмите предыдущий город и измените период.
Если вопрос содержит только название города, используйте предыдущий период, когда он есть.
Обычный вопрос о погоде без срока означает текущие условия.
Допустимые периоды: now — сейчас, today — прогноз на весь сегодняшний день, tomorrow — завтра.
Для других периодов, нескольких городов в одном вопросе и запросов не о погоде используйте unsupported.
Если город неизвестен и его нельзя взять из контекста, оставьте city пустым.
Если запрос поддержан и город известен, выберите инструмент для получения координат, затем инструмент для прогноза.
Если данных недостаточно или запрос не поддерживается, верните пустой массив tools.
Никогда не отвечайте на вопрос о погоде самостоятельно. Названия инструментов берите из каталога во входных данных.`;

export function createPlanner(config) {
  return async (question, previous, tools) => {
    const schema = {
      type: 'object',
      properties: {
        city: { type: 'string' },
        period: { type: 'string', enum: ['now', 'today', 'tomorrow', 'unsupported'] },
        tools: { type: 'array', items: { type: 'string', enum: tools.map(tool => tool.name) } },
      },
      required: ['city', 'period', 'tools'],
      additionalProperties: false,
    };
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify({ question, previous, tools }) },
        ],
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name: 'weather_plan', strict: true, schema } },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Провайдер LLM вернул HTTP ${response.status}.`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    let decision;
    try {
      decision = JSON.parse(content);
    } catch {
      throw new Error('Модель вернула ответ вне схемы.');
    }
    if (typeof decision?.city !== 'string' || decision.city.length > 150
      || !schema.properties.period.enum.includes(decision.period) || !Array.isArray(decision.tools)) {
      throw new Error('Модель вернула некорректный план.');
    }
    return decision;
  };
}
