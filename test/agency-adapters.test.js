import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyAgencyAdapters } from '../src/agency-adapters.js';

async function mapping(value) {
  const directory = await mkdtemp(join(tmpdir(), 'agency-adapters-'));
  const path = join(directory, 'mapping.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

test('applies selected adapters without mutating configs or allowlists', async () => {
  const profile = Object.freeze({ name: 'M365-Profile', type: 'http', url: 'https://profile.example/mcp', headers: {}, tools: Object.freeze(['GetMyDetails']), disabled: false });
  const calendar = Object.freeze({ name: 'M365-Calendar', url: 'https://calendar.example/mcp', tools: Object.freeze(['ListEvents', 'GetRooms']) });
  const webiq = Object.freeze({ name: 'webiq', url: 'https://search.example.test/mcp', headers: Object.freeze({ 'x-apikey': 'preserved' }), tools: Object.freeze(['web']) });
  const source = new Map([['M365-Profile', profile], ['M365-Calendar', calendar], ['webiq', webiq]]);
  const result = await applyAgencyAdapters(source, await mapping({ 'M365-Profile': 'm365-user', 'M365-Calendar': 'calendar' }));

  assert.notEqual(result, source);
  assert.deepEqual(source.get('M365-Profile'), profile);
  assert.deepEqual(result.get('M365-Profile'), { name: 'M365-Profile', type: 'stdio', command: 'agency', args: ['mcp', 'm365-user'], tools: ['GetMyDetails'], disabled: false });
  assert.deepEqual(result.get('M365-Calendar'), { name: 'M365-Calendar', command: 'agency', args: ['mcp', 'calendar'], tools: ['ListEvents', 'GetRooms'] });
  assert.deepEqual(result.get('webiq'), webiq);
  assert.notEqual(result.get('webiq'), webiq);
  assert.notEqual(result.get('webiq').headers, webiq.headers);
  assert.notEqual(result.get('M365-Calendar').tools, calendar.tools);
});

test('rejects unsupported aliases and incorrect builtins', async () => {
  const configs = new Map([['M365-Profile', { name: 'M365-Profile', url: 'https://example.test' }]]);
  const unknownAlias = await mapping({ Unknown: 'mail' });
  const wrongBuiltin = await mapping({ 'M365-Profile': 'mail' });
  await assert.rejects(() => applyAgencyAdapters(configs, unknownAlias), /unsupported server alias Unknown/);
  await assert.rejects(() => applyAgencyAdapters(configs, wrongBuiltin), /M365-Profile must map to m365-user/);
});

test('rejects mappings for servers absent from the active map', async () => {
  const path = await mapping({ ICM: 'icm' });
  await assert.rejects(() => applyAgencyAdapters(new Map(), path), /unknown server ICM/);
});

test('rejects selected backends with custom headers', async () => {
  const configs = new Map([['Enghub', { name: 'Enghub', url: 'https://docs.example.test/mcp', headers: { Authorization: 'sensitive' }, tools: ['search'] }]]);
  const path = await mapping({ Enghub: 'enghub' });
  await assert.rejects(() => applyAgencyAdapters(configs, path), /non-empty custom headers/);
  assert.equal(configs.get('Enghub').headers.Authorization, 'sensitive');
});

test('rejects selected non-HTTP backends', async () => {
  const configs = new Map([['ICM', { name: 'ICM', command: 'node', args: ['server.js'], tools: ['search_incidents'] }]]);
  const path = await mapping({ ICM: 'icm' });
  await assert.rejects(() => applyAgencyAdapters(configs, path), /requires an HTTP backend with a URL/);
});

test('requires a Map and a JSON object mapping', async () => {
  const empty = await mapping({});
  const array = await mapping([]);
  await assert.rejects(() => applyAgencyAdapters({}, empty), /configsMap to be a Map/);
  await assert.rejects(() => applyAgencyAdapters(new Map(), array), /root must be a JSON object/);
});

