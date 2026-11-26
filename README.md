# Погодный агент

Браузерный чат о текущей погоде и прогнозе на сегодня или завтра. Модель `google/gemini-3.1-flash-lite` через VseLLM определяет город и период, затем выбирает инструменты из каталога удалённого [Open-Meteo MCP](https://github.com/IBM/chuk-mcp-open-meteo).

## Запуск

Требуются Node.js 22.9 или новее, интернет и ключ VseLLM. В текущей рабочей папке файл `.env` уже настроен. На другой машине скопируйте `.env.example` в `.env` и укажите свой `OPENAI_API_KEY`. Ключ используется только серверной частью чата. Для погодного MCP ключ не нужен.

```powershell
npm.cmd ci
npm.cmd start
```

Откройте [погодный чат](http://127.0.0.1:3049). Если порт занят, измените `PORT` в `.env`.

## Как проходит запрос

1. Браузер передаёт вопрос и контекст предыдущей реплики серверу приложения.
2. Сервер получает список инструментов через `tools/list` по адресу `https://weather.chukai.io/mcp`. Модель возвращает город, период и имена инструментов.
3. MCP-клиент вызывает `geocode_location`, затем передаёт найденные координаты инструменту `get_weather_forecast`. Удалённый MCP-сервер запрашивает Open-Meteo.
4. Сервер приложения формирует ответ на русском из полученных значений. Он переводит [коды погоды WMO](https://open-meteo.com/en/docs#weather_variable_documentation) и добавляет местное время данных, если оно есть. Журнал MCP показывает инструмент, город и результат в браузере и в консоли.

Если город не найден или один из вызовов завершился ошибкой, чат показывает сообщение об этом. Если Open-Meteo пропустил отдельный показатель, чат опускает его.

## Развёртывание в ChatGPT Sites

`npm.cmd run build` собирает интерфейс и серверную часть в `dist/server/index.js`. Ключ VseLLM хранится в секрете Sites `VSELLM_API_KEY`. При публичном доступе посетители могут пользоваться чатом без входа в ChatGPT.

## Проверка

В одном диалоге задайте «Какая сейчас погода в Екатеринбурге?», затем «А в Казани?». В журнале появятся по два вызова для каждого города. Команда `npm.cmd run verify` проверяет обе реплики с реальными VseLLM и MCP, а также обработку отказа в подключении. Проверка отказа обращается к закрытому порту и не запускает MCP-сервер.

Результат проверки 26 ноября 2026 года, время местное для каждого города.

| Город | Время | Температура | Условия | Ветер |
| --- | --- | --- | --- | --- |
| Екатеринбург | 17:45 | −2,9 °C | Небольшой снег | 4,12 м/с |
| Казань | 15:45 | −2,3 °C | Небольшой снег | 4,82 м/с |

## Обложка журнала

`public/clouds.png` создан встроенным ImageGen по следующему запросу.

> A single realistic fine-art landscape photograph for the top of a narrow browser weather app sidebar, wide landscape aspect 3:2. Quiet blue-gray mountains rolling into the distance and an expanse of layered dramatic rain clouds with a small break in the cloud deck toward top-right; subtle cool slate-blue color grading and mist, dark atmospheric foreground. Place rugged ridgelines low in the frame so it also works cropped to a short panoramic 2.4:1 strip. Modern weather editorial photography, natural soft grain and understated depth. No text, no numbers, no graphics, no weather icons, no buildings, no people, no visible sun flare.
