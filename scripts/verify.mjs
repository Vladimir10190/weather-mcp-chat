import assert from 'node:assert/strict';
import { once } from 'node:events';
import { configureModel, createPlanner } from '../model.mjs';
import { makeServer } from '../server.mjs';

const config = configureModel();
const plan = createPlanner(config);

async function exercise(mcpUrl, run) {
  const server = makeServer(plan, config.model, mcpUrl).listen(0, '127.0.0.1');
  await once(server, 'listening');
  async function ask(question, previous) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, previous }),
      signal: AbortSignal.timeout(90_000),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const answer = events.find(event => event.type === 'answer');
    assert.ok(answer);
    console.log(`\n> ${question}\n${answer.answer}`);
    return { ...answer, trace: events.filter(event => event.type === 'trace') };
  }
  try {
    await run(ask);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function checkWeather(result, city) {
  assert.equal(result.error, undefined);
  assert.deepEqual(result.context, { city, period: 'now' });
  assert.match(result.answer, /°C/);
  assert.match(result.answer, /м\/с/);
  assert.deepEqual(result.trace.map(({ tool, city, status }) => [tool, city, status]), [
    ['geocode_location', city, 'calling'],
    ['geocode_location', city, 'success'],
    ['get_weather_forecast', city, 'calling'],
    ['get_weather_forecast', city, 'success'],
  ]);
}

await exercise(undefined, async ask => {
  const first = await ask('Какая сейчас погода в Екатеринбурге?');
  checkWeather(first, 'Екатеринбург');
  const followup = await ask('А в Казани?', first.context);
  checkWeather(followup, 'Казань');
});

// This URL deliberately refuses the connection. No MCP server is started locally.
await exercise('http://127.0.0.1:1/mcp', async ask => {
  const failure = await ask('Какая сейчас погода в Екатеринбурге?');
  assert.equal(failure.error, 'mcp_error');
  assert.doesNotMatch(failure.answer, /°C|м\/с/);
  assert.ok(failure.trace.some(event => event.status === 'error'));
});
console.log('\nПроверка пройдена.');
