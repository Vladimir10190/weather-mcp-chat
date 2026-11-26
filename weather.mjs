import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const defaultMcpUrl = 'https://weather.chukai.io/mcp';
export const periods = ['now', 'today', 'tomorrow'];
const geocodeTool = 'geocode_location';
const forecastTool = 'get_weather_forecast';
const requestOptions = { timeout: 18_000 };
const dailyVariables = 'temperature_2m_min,temperature_2m_max,weather_code,wind_speed_10m_max';
const codes = new Map(Object.entries({
  0: 'ясно', 1: 'преимущественно ясно', 2: 'переменная облачность', 3: 'пасмурно',
  45: 'туман', 48: 'туман с изморозью',
  51: 'слабая морось', 53: 'морось', 55: 'сильная морось',
  56: 'слабая ледяная морось', 57: 'сильная ледяная морось',
  61: 'небольшой дождь', 63: 'дождь', 65: 'сильный дождь',
  66: 'небольшой ледяной дождь', 67: 'сильный ледяной дождь',
  71: 'небольшой снег', 73: 'снег', 75: 'сильный снег', 77: 'снежные зёрна',
  80: 'небольшой ливень', 81: 'ливень', 82: 'сильный ливень',
  85: 'небольшой снежный заряд', 86: 'сильный снежный заряд',
  95: 'гроза', 96: 'гроза с небольшим градом', 97: 'сильная гроза', 99: 'гроза с сильным градом',
}));

class WeatherError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function parseToolResult(result) {
  if (result.isError) throw new Error('MCP вернул ошибку инструмента.');
  const block = result.content?.find(item => item.type === 'text');
  const data = result.structuredContent ?? JSON.parse(block?.text ?? 'null');
  if (!data || data.error || typeof data !== 'object') {
    throw new Error('MCP вернул пустой ответ или ошибку.');
  }
  return data;
}

function locate(data) {
  const place = data.results?.[0];
  if (!place) throw new WeatherError('город не найден', 'city_not_found');
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || !place.name) {
    throw new Error('Отсутствуют сведения о городе.');
  }
  return place;
}

function toWeather(data, period) {
  const dayIndex = period === 'tomorrow' ? 1 : 0;
  const current = data.current_weather;
  const daily = data.daily;
  const values = period === 'now' ? {
    temperature: current?.temperature,
    wind: current?.windspeed,
    condition: codes.get(String(current?.weathercode)),
    stamp: current?.time,
  } : {
    min: daily?.temperature_2m_min?.[dayIndex],
    max: daily?.temperature_2m_max?.[dayIndex],
    wind: daily?.wind_speed_10m_max?.[dayIndex],
    condition: codes.get(String(daily?.weather_code?.[dayIndex] ?? daily?.weathercode?.[dayIndex])),
    stamp: daily?.time?.[dayIndex],
  };
  if (![values.temperature, values.min, values.max, values.wind].some(Number.isFinite) && !values.condition) {
    throw new Error('Отсутствуют погодные значения для выбранного периода.');
  }
  return values;
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const signed = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

function formatWeather(place, period, weather) {
  const parts = [];
  if (Number.isFinite(weather.temperature)) parts.push(`${signed.format(weather.temperature)} °C`);
  if (Number.isFinite(weather.min) && Number.isFinite(weather.max)) {
    parts.push(`от ${signed.format(weather.min)} до ${signed.format(weather.max)} °C`);
  } else if (Number.isFinite(weather.min)) {
    parts.push(`минимум ${signed.format(weather.min)} °C`);
  } else if (Number.isFinite(weather.max)) {
    parts.push(`максимум ${signed.format(weather.max)} °C`);
  }
  if (weather.condition) parts.push(weather.condition);
  if (Number.isFinite(weather.wind)) {
    const wind = period === 'now' ? 'ветер' : 'ветер до';
    parts.push(`${wind} ${number.format(weather.wind)} м/с`);
  }
  const heading = { now: 'Сейчас', today: 'Прогноз на сегодня', tomorrow: 'Прогноз на завтра' }[period];
  const localTime = period === 'now' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(weather.stamp)
    ? ` По данным на ${weather.stamp.slice(11, 16)} по местному времени.`
    : '';
  return `${place.name}. ${heading} — ${parts.join(', ')}.${localTime}`;
}

export function createWeatherAgent(plan, mcpUrl, jsonSchemaValidator) {
  return async (question, previous, emitTrace) => {
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      fetch: (input, init) => {
        const deadline = AbortSignal.timeout(requestOptions.timeout);
        const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        return fetch(input, { ...init, signal });
      },
    });
    const client = new Client({ name: 'weather-mcp-chat', version: '1.0.0' }, { jsonSchemaValidator });
    let city;
    let period;

    function trace(tool, status, detail) {
      const entry = { tool, city: city ?? null, status, detail };
      console.log('[MCP]', JSON.stringify(entry));
      emitTrace(entry);
    }

    async function useTool(name, args, read, summarize) {
      trace(name, 'calling', 'Запрос отправлен');
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, requestOptions);
        const value = read(parseToolResult(result));
        trace(name, 'success', summarize(value));
        return value;
      } catch (error) {
        trace(name, 'error', error.code === 'city_not_found' ? 'Город не найден' : 'Данные не получены');
        if (error instanceof WeatherError) throw error;
        console.warn('[MCP]', name, error.message);
        throw new WeatherError('Не удалось получить данные от погодного сервера.', 'mcp_error');
      }
    }

    try {
      let tools;
      try {
        await client.connect(transport, requestOptions);
        const list = await client.listTools({}, requestOptions);
        tools = list.tools.flatMap(({ name }) => {
          if (name === geocodeTool) return [{ name, description: 'Find coordinates for a city name.' }];
          if (name === forecastTool) return [{ name, description: 'Get current and daily weather by coordinates.' }];
          return [];
        });
        if (tools.length !== 2) throw new Error('Отсутствуют необходимые MCP-инструменты.');
      } catch (error) {
        trace('tools/list', 'error', 'Не удалось открыть каталог инструментов MCP');
        console.warn('[MCP] Подключение', error.message);
        throw new WeatherError('Погодный MCP-сервер сейчас недоступен. Попробуйте ещё раз позже.', 'mcp_error');
      }

      let decision;
      try {
        decision = await plan(question, previous, tools);
      } catch (error) {
        console.warn('[LLM]', error.message);
        throw new WeatherError('Не удалось обработать вопрос. Попробуйте указать город и период.', 'model_error');
      }
      city = decision.city.trim();
      period = decision.period;
      if (period === 'unsupported') {
        return { answer: 'Спросите о текущей погоде или о прогнозе на сегодня или завтра.' };
      }
      if (!city) {
        return { answer: 'В каком городе посмотреть погоду?', context: { city: '', period } };
      }
      if (decision.tools.length !== 2 || decision.tools[0] !== geocodeTool || decision.tools[1] !== forecastTool) {
        throw new WeatherError('Не удалось подобрать инструменты. Переформулируйте вопрос о погоде.', 'model_error');
      }

      const place = await useTool(decision.tools[0], { name: city, language: 'ru', count: 1 }, locate, found => {
        const region = [found.name, found.country].filter(Boolean).join(', ');
        return `${region} · ${found.latitude.toFixed(2)}, ${found.longitude.toFixed(2)}`;
      });
      city = place.name;
      const args = {
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: 'auto',
        temperature_unit: 'celsius',
        wind_speed_unit: 'ms',
        forecast_days: period === 'tomorrow' ? 2 : 1,
        current_weather: period === 'now',
      };
      if (period !== 'now') args.daily = dailyVariables;
      const weather = await useTool(decision.tools[1], args, data => toWeather(data, period), () => 'Погодные данные получены');
      return { answer: formatWeather(place, period, weather), context: { city, period } };
    } catch (error) {
      if (!(error instanceof WeatherError)) throw error;
      const answer = error.code === 'city_not_found'
        ? `Не удалось найти город «${city}». Проверьте название или уточните регион.`
        : error.message;
      return { answer, error: error.code, ...(city && { context: { city, period } }) };
    } finally {
      if (transport.sessionId) {
        // A failing session cleanup must not hide a successfully retrieved forecast.
        await transport.terminateSession().catch(() => {});
      }
      await client.close().catch(() => {});
    }
  };
}
