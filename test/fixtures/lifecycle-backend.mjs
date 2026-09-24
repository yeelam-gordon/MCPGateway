import { appendFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

if (process.env.COUNTER_FILE) appendFileSync(process.env.COUNTER_FILE, `${process.pid}\n`);
const server = new McpServer({ name: 'lifecycle-backend', version: '1' });
server.registerTool('echo', {
  description: 'Return the input and backend process identity.',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({
  content: [{ type: 'text', text: JSON.stringify({ text, pid: process.pid }) }],
  structuredContent: { text, pid: process.pid },
}));
await server.connect(new StdioServerTransport());
