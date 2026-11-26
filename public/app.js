const byId = id => document.getElementById(id);
const messages = byId('messages');
const transcript = byId('transcript');
const form = byId('ask');
const questionField = byId('question');
const send = byId('send');
const reset = byId('reset');
const trace = byId('trace');
const status = byId('status');
const followups = byId('followups');
const switchCity = byId('switch-city');
let previous = null;
let busy = false;

fetch('/api/config').then(response => response.json()).then(({ mcpUrl, model }) => {
  const endpoint = new URL(mcpUrl);
  byId('endpoint').textContent = endpoint.host + endpoint.pathname;
  byId('model').textContent = `Модель · ${model}`;
}).catch(() => {});

function updateStatus(label, state = '') {
  status.textContent = label;
  status.dataset.state = state;
}

function addMessage(kind, text) {
  const article = document.createElement('article');
  article.className = `message ${kind}`;
  const label = document.createElement('strong');
  label.textContent = kind === 'user' ? 'Вы' : 'Погодный агент';
  const content = document.createElement('p');
  content.textContent = text;
  article.append(label, content);
  messages.append(article);
  transcript.scrollTop = transcript.scrollHeight;
  return content;
}

function showTrace(event, pending) {
  byId('empty-log').hidden = true;
  let entry = pending.get(event.tool);
  if (!entry) {
    const row = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = 'trace-heading';
    const tool = document.createElement('code');
    tool.textContent = event.tool;
    const badge = document.createElement('span');
    heading.append(tool, badge);
    const city = document.createElement('p');
    city.className = 'trace-city';
    const detail = document.createElement('p');
    detail.className = 'trace-detail';
    row.append(heading, city, detail);
    trace.prepend(row);
    entry = { row, badge, city, detail };
    if (event.status === 'calling') pending.set(event.tool, entry);
  }
  entry.row.dataset.state = event.status;
  entry.badge.textContent = { calling: 'В работе', success: 'Готово', error: 'Ошибка' }[event.status];
  entry.city.textContent = event.city ?? 'Подключение к серверу';
  entry.detail.textContent = event.detail;
  if (event.status !== 'calling') pending.delete(event.tool);
}

async function request(question, onEvent) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, previous }),
  });
  if (!response.ok || !response.body) throw new Error('Запрос не выполнен.');
  let buffer = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = (buffer + chunk).split('\n');
    buffer = lines.pop();
    for (const line of lines) onEvent(JSON.parse(line));
  }
  if (buffer) onEvent(JSON.parse(buffer));
}

async function submit(rawQuestion) {
  const question = rawQuestion.trim();
  if (!question || busy) return;
  busy = true;
  questionField.value = '';
  send.disabled = reset.disabled = true;
  byId('welcome').hidden = true;
  reset.hidden = false;
  followups.hidden = true;
  addMessage('user', question);
  const answer = addMessage('agent', 'Проверяю погодные данные…');
  answer.classList.add('pending');
  updateStatus('В работе', 'calling');
  const pending = new Map();
  let gotAnswer = false;
  let usedWeather = false;
  try {
    await request(question, event => {
      if (event.type === 'trace') {
        showTrace(event, pending);
        usedWeather ||= event.tool === 'get_weather_forecast' && event.status === 'success';
      }
      if (event.type === 'answer') {
        gotAnswer = true;
        answer.textContent = event.answer;
        if (event.context) previous = event.context;
        if (event.error) updateStatus('Ошибка', 'error');
        else if (usedWeather) updateStatus('Данные получены', 'success');
        else updateStatus('Ожидание');
        if (usedWeather && previous?.city) {
          switchCity.textContent = previous.city === 'Казань' ? 'А в Екатеринбурге?' : 'А в Казани?';
          followups.hidden = false;
        }
      }
    });
    if (!gotAnswer) throw new Error('Ответ не завершён.');
  } catch {
    for (const [tool, entry] of pending) {
      showTrace({ tool, city: entry.city.textContent, status: 'error', detail: 'Ответ прерван' }, pending);
    }
    answer.textContent = 'Не удалось получить ответ от приложения. Попробуйте ещё раз.';
    updateStatus('Ошибка', 'error');
  } finally {
    answer.classList.remove('pending');
    busy = false;
    send.disabled = reset.disabled = false;
    transcript.scrollTop = transcript.scrollHeight;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  submit(questionField.value);
});
document.querySelectorAll('[data-prompt]').forEach(button => {
  button.addEventListener('click', () => submit(button.dataset.prompt));
});
switchCity.addEventListener('click', () => submit(switchCity.textContent));
reset.addEventListener('click', () => {
  previous = null;
  messages.replaceChildren();
  trace.replaceChildren();
  byId('welcome').hidden = false;
  byId('empty-log').hidden = false;
  followups.hidden = true;
  reset.hidden = true;
  questionField.value = '';
  questionField.focus();
  updateStatus('Ожидание');
});
