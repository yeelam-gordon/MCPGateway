import { readFile } from 'node:fs/promises';

const SUPPORTED_ADAPTERS = Object.freeze({
  M365_Mail: 'mail',
  'M365-Calendar': 'calendar',
  'M365-Teams': 'teams',
  'M365-Search': 'm365-copilot',
  'M365-Sharepoint': 'sharepoint',
  'M365-Word': 'word',
  'M365-Profile': 'm365-user',
  ICM: 'icm',
  Enghub: 'enghub'
});

function cloneConfig(config) {
  return {
    ...config,
    ...(config.args && { args: [...config.args] }),
    ...(config.env && { env: { ...config.env } }),
    ...(config.headers && { headers: { ...config.headers } }),
    ...(config.tools && { tools: [...config.tools] })
  };
}

async function loadAdapterMapping(path) {
  if (typeof path !== 'string' || path.length === 0) throw new Error('Agency adapter path must be a non-empty string');
  let value;
  try { value = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new Error(`Cannot read Agency adapter mapping ${path}: ${error.message}`, { cause: error }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Agency adapter mapping ${path}: root must be a JSON object`);
  }
  for (const [name, builtin] of Object.entries(value)) {
    if (!Object.hasOwn(SUPPORTED_ADAPTERS, name)) {
      throw new Error(`Invalid Agency adapter mapping ${path}: unsupported server alias ${name}`);
    }
    if (typeof builtin !== 'string' || builtin !== SUPPORTED_ADAPTERS[name]) {
      throw new Error(`Invalid Agency adapter mapping ${path}: ${name} must map to ${SUPPORTED_ADAPTERS[name]}`);
    }
  }
  return value;
}

export async function applyAgencyAdapters(configsMap, adapterPath) {
  if (!(configsMap instanceof Map)) throw new TypeError('Agency adapters require configsMap to be a Map');
  const mapping = await loadAdapterMapping(adapterPath);
  const result = new Map([...configsMap].map(([name, config]) => [name, cloneConfig(config)]));

  for (const [name, builtin] of Object.entries(mapping)) {
    const original = configsMap.get(name);
    if (!original) throw new Error(`Agency adapter mapping references unknown server ${name}`);
    if (typeof original.url !== 'string' || original.url.length === 0 || original.command) {
      throw new Error(`Agency adapter ${name} requires an HTTP backend with a URL`);
    }
    const nonemptyHeaders = Object.entries(original.headers ?? {}).filter(([, value]) => String(value).length > 0);
    if (nonemptyHeaders.length > 0) {
      throw new Error(`Agency adapter ${name} cannot replace a backend with non-empty custom headers`);
    }

    const adapted = cloneConfig(original);
    delete adapted.url;
    delete adapted.headers;
    adapted.command = 'agency';
    adapted.args = ['mcp', builtin];
    if (Object.hasOwn(adapted, 'type')) adapted.type = 'stdio';
    result.set(name, adapted);
  }

  return result;
}
