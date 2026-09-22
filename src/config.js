import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const stringMap = z.record(z.string(), z.string());
const backendSchema = z.object({
  disabled: z.boolean().optional(), type: z.enum(['http', 'stdio', 'local']).optional(), command: z.string().min(1).optional(), args: z.array(z.string()).optional(),
  cwd: z.string().min(1).optional(), env: stringMap.optional(), url: z.string().url().optional(),
  headers: stringMap.optional(), tools: z.array(z.string().min(1)).optional(),
  timeout: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.command) === Boolean(value.url)) context.addIssue({ code: 'custom', message: 'exactly one of command or url is required' });
});
const configSchema = z.object({
  mcpServers: z.record(z.string().min(1), backendSchema).optional(),
  servers: z.record(z.string().min(1), backendSchema).optional()
}).passthrough().superRefine((value, context) => {
  if (!value.mcpServers && !value.servers) context.addIssue({ code: 'custom', message: 'mcpServers or servers object is required' });
});

export async function loadConfig(path, ownNames = new Set(['shared-mcp-gateway'])) {
  let json;
  try { json = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read MCP config ${path}: ${error.message}`, { cause: error }); }
  const parsed = configSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Invalid MCP config ${path}: ${z.prettifyError(parsed.error)}`);
  const source = parsed.data.mcpServers ?? parsed.data.servers;
  const backends = new Map();
  for (const [name, settings] of Object.entries(source)) {
    if (!settings.disabled && !ownNames.has(name)) {
      const { timeout: _nativeClientTimeout, ...backendSettings } = settings;
      backends.set(name, Object.freeze({ name, ...backendSettings }));
    }
  }
  return backends;
}

export function redactedMetadata(config, state) {
  return { name: config.name, transport: config.url ? 'http' : 'stdio', state,
    toolAllowlistConfigured: Array.isArray(config.tools), allowedToolCount: config.tools?.length ?? null };
}
