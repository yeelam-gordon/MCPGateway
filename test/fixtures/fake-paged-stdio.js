import { appendFileSync, existsSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

if (process.env.COUNTER_FILE) appendFileSync(process.env.COUNTER_FILE, `${process.pid}\n`);
const cycleOnce = process.env.CYCLE_ONCE_FILE && !existsSync(process.env.CYCLE_ONCE_FILE);
if (cycleOnce) appendFileSync(process.env.CYCLE_ONCE_FILE, 'cycled\n');
const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const server = new Server({ name: 'fake-paged', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, request => {
  const cursor = request.params?.cursor;
  if (!cursor) return { tools: [{ name: 'page_one', description: 'first page', inputSchema: schema }, { name: 'unsupported', inputSchema: { $schema: 'https://json-schema.org/draft/2019-09/schema', type: 'object' } }], nextCursor: 'page-2' };
  if (process.env.CURSOR_CYCLE === '1' || cycleOnce) return { tools: [{ name: 'repeat', inputSchema: schema }], nextCursor: 'page-2' };
  return { tools: [{ name: 'page_two', description: 'second page', inputSchema: schema }] };
});
server.setRequestHandler(CallToolRequestSchema, request => ({ content: [{ type: 'text', text: request.params.arguments?.text ?? '' }] }));
await server.connect(new StdioServerTransport());
