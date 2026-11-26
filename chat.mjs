import { periods } from './weather.mjs';

export const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/clouds.png', ['clouds.png', 'image/png']],
]);

export const chatHeaders = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
};

export async function readQuestion(chunks) {
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for await (const chunk of chunks) {
    size += chunk.length;
    if (size > 8192) throw new Error('Запрос слишком длинный.');
    text += decoder.decode(chunk, { stream: true });
  }
  const payload = JSON.parse(text + decoder.decode());
  const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
  if (!question || question.length > 500) throw new Error('Введите вопрос длиной до 500 символов.');
  const { city, period } = payload.previous ?? {};
  const previous = typeof city === 'string' && city.length <= 150 && periods.includes(period)
    ? { city, period }
    : null;
  return { question, previous };
}

export async function runChat(ask, { question, previous }, send) {
  const event = (type, payload = {}) => send(`${JSON.stringify({ type, ...payload })}\n`);
  event('start');
  try {
    const answer = await ask(question, previous, entry => event('trace', entry));
    event('answer', answer);
  } catch (error) {
    console.error(error);
    event('answer', { answer: 'Не удалось обработать запрос. Попробуйте ещё раз.', error: 'internal_error' });
  }
}
