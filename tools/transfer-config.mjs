import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT = 'shared-mcp-gateway-transfer';
const VERSION = 1;
const PLACEHOLDER_PATTERN = /^\{\{MCP_GATEWAY_VALUE_(\d{4})\}\}$/;
const USAGE = 'Usage: node tools/transfer-config.mjs export --source PATH --output DIR\n       node tools/transfer-config.mjs import --input DIR --output PATH --values PATH';
const SECRET_FLAGS = new Set([
  '--access-key', '--api-key', '--apikey', '--auth', '--authorization', '--client-secret',
  '--credential', '--credentials', '--login', '--password', '--private-key', '--secret',
  '--session-token', '--state', '--token'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedKey(value) {
  return String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return normalized === 'auth' || normalized === 'authentication' || normalized === 'authorization'
    || normalized === 'cookie' || normalized === 'credentials' || normalized === 'login'
    || normalized === 'oauth' || normalized === 'password' || normalized === 'privatekey'
    || normalized === 'secret' || normalized === 'sessiontoken' || normalized === 'state'
    || normalized === 'token' || normalized.endsWith('apikey') || normalized.endsWith('accesstoken')
    || normalized.endsWith('clientsecret') || normalized.endsWith('password')
    || normalized.endsWith('privatekey') || normalized.endsWith('secret')
    || normalized.endsWith('token');
}

function isSecretFlag(value) {
  return SECRET_FLAGS.has(String(value).toLowerCase());
}

function isSecretAssignment(value) {
  const match = String(value).match(/^(?:--?)?([^=]+)=(.*)$/s);
  return Boolean(match && isSensitiveKey(match[1]));
}

function isAbsoluteMachinePath(value) {
  const text = String(value).trim();
  if (!text) return false;
  if (/^file:\/\//i.test(text)) return true;
  if (win32.isAbsolute(text) || posix.isAbsolute(text)) return true;
  const assignment = text.indexOf('=');
  if (assignment >= 0) {
    const assigned = text.slice(assignment + 1).trim();
    if (win32.isAbsolute(assigned) || posix.isAbsolute(assigned) || /^file:\/\//i.test(assigned)) return true;
  }
  return /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/.test(text);
}

function inspectUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return null;
  if (url.username || url.password) return 'URL contains user information';
  for (const [key, queryValue] of url.searchParams) {
    if (isSensitiveKey(key)) return 'URL contains a credential query parameter';
    if (isAbsoluteMachinePath(queryValue)) return 'URL contains an absolute path query value';
  }
  if (url.hash && (isSecretAssignment(url.hash.slice(1)) || /(?:token|password|secret|api[-_]?key)=/i.test(url.hash))) {
    return 'URL fragment contains credential data';
  }
  return null;
}

function configCollection(config) {
  if (!isObject(config)) throw new Error('Source config must be a JSON object');
  const keys = ['mcpServers', 'servers'].filter(key => Object.hasOwn(config, key));
  if (keys.length !== 1 || !isObject(config[keys[0]])) throw new Error('Source config must contain exactly one of mcpServers or servers');
  return { key: keys[0], servers: config[keys[0]] };
}

function validateEntry(name, entry) {
  if (!isObject(entry)) throw new Error(`Invalid MCP server entry: ${name}`);
  const hasCommand = typeof entry.command === 'string' && entry.command.length > 0;
  const hasUrl = typeof entry.url === 'string' && entry.url.length > 0;
  if (hasCommand === hasUrl) throw new Error(`Invalid MCP server entry ${name}: expected exactly one of command or url`);
  if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(value => typeof value !== 'string'))) {
    throw new Error(`Invalid MCP server entry ${name}: args must be an array of strings`);
  }
  for (const field of ['env', 'headers']) if (entry[field] !== undefined && !isObject(entry[field])) {
    throw new Error(`Invalid MCP server entry ${name}: ${field} must be an object`);
  }
  if (entry.cwd !== undefined && typeof entry.cwd !== 'string') throw new Error(`Invalid MCP server entry ${name}: cwd must be a string`);
  if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') throw new Error(`Invalid MCP server entry ${name}: disabled must be a boolean`);
  if (entry.tools !== undefined && (!Array.isArray(entry.tools) || entry.tools.some(value => typeof value !== 'string'))) {
    throw new Error(`Invalid MCP server entry ${name}: tools must be an array of strings`);
  }
}

function validateConfig(config) {
  const collection = configCollection(config);
  for (const [name, entry] of Object.entries(collection.servers)) validateEntry(name, entry);
  return collection;
}

async function readJson(path, label) {
  let bytes;
  try { bytes = await readFile(path); } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${path}`);
    throw error;
  }
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} is invalid JSON: ${path}`); }
}

async function pathExists(path) {
  try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sanitizer() {
  const requirements = [];
  function redact(server, field, reason) {
    const id = `MCP_GATEWAY_VALUE_${String(requirements.length + 1).padStart(4, '0')}`;
    requirements.push({ id, server, field, reason });
    return `{{${id}}}`;
  }
  function knownString(value, context) {
    const urlReason = inspectUrl(value);
    if (urlReason) return redact(context.server, context.field, urlReason);
    if (isAbsoluteMachinePath(value)) return redact(context.server, context.field, 'absolute machine path');
    if (isSecretAssignment(value)) return redact(context.server, context.field, 'credential assignment');
    return value;
  }
  function walk(value, context) {
    if (typeof value === 'string') {
      const inspected = knownString(value, context);
      return inspected === value ? redact(context.server, context.field, 'unclassified string value') : inspected;
    }
    if (Array.isArray(value)) return value.map((item, index) => walk(item, { ...context, field: `${context.field}[${index}]` }));
    if (!isObject(value)) return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const field = context.field ? `${context.field}.${key}` : key;
      if (isSensitiveKey(key)) output[key] = redact(context.server, field, 'credential or authentication field');
      else output[key] = walk(child, { ...context, field });
    }
    return output;
  }
  function entry(server, value) {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'env' || key === 'headers') && isObject(child)) {
        output[key] = Object.fromEntries(Object.keys(child).map(name => [name, redact(server, `${key}.${name}`, `${key} value`)]));
        continue;
      }
      if (key === 'args' && Array.isArray(child)) {
        output[key] = child.map((argument, index) => {
          const field = `args[${index}]`;
          if (index > 0 && isSecretFlag(child[index - 1])) return redact(server, field, `value for ${child[index - 1]}`);
          const inspected = knownString(argument, { server, field });
          if (inspected !== argument) return inspected;
          if (argument.startsWith('-') && !argument.includes('=')) return argument;
          if (index > 0 && ['--org', '--organization'].includes(child[index - 1].toLowerCase())) return argument;
          return redact(server, field, 'argument value requires explicit materialization');
        });
        continue;
      }
      if (['tools', 'type', 'disabled', 'timeout'].includes(key)) output[key] = child;
      else if (['command', 'url', 'cwd'].includes(key) && typeof child === 'string') output[key] = knownString(child, { server, field: key });
      else if (isSensitiveKey(key)) output[key] = redact(server, key, 'credential or authentication field');
      else output[key] = walk(child, { server, field: key });
    }
    return output;
  }
  return { requirements, entry, walk };
}

function buildTemplate(config) {
  const { key, servers } = validateConfig(config);
  const redact = sanitizer();
  const sanitized = {};
  for (const [name, value] of Object.entries(config)) {
    if (name === key) sanitized[name] = Object.fromEntries(Object.entries(servers).map(([server, entry]) => [server, redact.entry(server, entry)]));
    else sanitized[name] = redact.walk(value, { server: '$config', field: name });
  }
  return {
    template: { format: FORMAT, version: VERSION, collection: key, placeholderCount: redact.requirements.length, config: sanitized },
    manifest: redact.requirements
  };
}

function collectPlaceholders(value, output = []) {
  if (typeof value === 'string') {
    const match = value.match(PLACEHOLDER_PATTERN);
    if (match) output.push(match[0].slice(2, -2));
    else if (value.includes('{{MCP_GATEWAY_VALUE_')) throw new Error('Template contains a malformed placeholder');
  } else if (Array.isArray(value)) {
    for (const item of value) collectPlaceholders(item, output);
  } else if (isObject(value)) {
    for (const item of Object.values(value)) collectPlaceholders(item, output);
  }
  return output;
}

function validatePackage(template, manifest) {
  if (!isObject(template) || template.format !== FORMAT || template.version !== VERSION || !isObject(template.config)) {
    throw new Error('Unsupported or malformed template.json');
  }
  if (!Array.isArray(manifest)) throw new Error('Unsupported or malformed requirements.json');
  const collection = validateConfig(template.config);
  if (template.collection !== collection.key) throw new Error('Template collection metadata does not match its config');
  const placeholders = collectPlaceholders(template.config);
  const placeholderSet = new Set(placeholders);
  if (placeholders.length !== placeholderSet.size) throw new Error('Template reuses a placeholder');
  if (template.placeholderCount !== placeholders.length || manifest.length !== placeholders.length) {
    throw new Error('Transfer package placeholder counts do not match');
  }
  const requirementIds = new Set();
  for (const requirement of manifest) {
    if (!isObject(requirement) || typeof requirement.id !== 'string' || typeof requirement.server !== 'string'
      || typeof requirement.field !== 'string' || typeof requirement.reason !== 'string') throw new Error('Malformed transfer requirement');
    if (requirementIds.has(requirement.id)) throw new Error('Duplicate transfer requirement');
    requirementIds.add(requirement.id);
  }
  if (requirementIds.size !== placeholderSet.size || [...requirementIds].some(id => !placeholderSet.has(id))) {
    throw new Error('requirements.json does not describe the template placeholders');
  }
  return { collection, placeholders };
}

function materialize(value, values) {
  if (typeof value === 'string') {
    const match = value.match(PLACEHOLDER_PATTERN);
    return match ? values[value.slice(2, -2)] : value;
  }
  if (Array.isArray(value)) return value.map(item => materialize(item, values));
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child, values)]));
}

export function parseTransferArgs(argv) {
  const operation = argv[0];
  const allowed = operation === 'export' ? new Set(['--source', '--output'])
    : operation === 'import' ? new Set(['--input', '--output', '--values']) : null;
  if (!allowed) throw new Error(USAGE);
  const options = { operation };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag) || Object.hasOwn(options, flag.slice(2))) throw new Error(USAGE);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(USAGE);
    options[flag.slice(2)] = value;
  }
  if ([...allowed].some(flag => !options[flag.slice(2)])) throw new Error(USAGE);
  return options;
}

export async function exportConfig(options) {
  const sourcePath = resolve(options?.source ?? '');
  const outputPath = resolve(options?.output ?? '');
  if (!options?.source || !options?.output) throw new Error('Export requires source and output paths');
  const config = await readJson(sourcePath, 'Source config');
  const { template, manifest } = buildTemplate(config);
  if (await pathExists(outputPath)) throw new Error(`Refusing to overwrite existing export path: ${outputPath}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(outputPath, { recursive: false });
  try {
    await writeFile(resolve(outputPath, 'template.json'), jsonBytes(template), { flag: 'wx', mode: 0o600 });
    await writeFile(resolve(outputPath, 'requirements.json'), jsonBytes(manifest), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await rm(outputPath, { recursive: true, force: true });
    throw error;
  }
  return { status: 'exported', collection: template.collection, serverCount: Object.keys(template.config[template.collection]).length,
    placeholderCount: template.placeholderCount, outputPath };
}

export const exportTransferConfig = exportConfig;

export async function importConfig(options) {
  if (!options?.input || !options?.output || !options?.values) throw new Error('Import requires input, output, and values paths');
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const valuesPath = resolve(options.values);
  const [template, manifest, values] = await Promise.all([
    readJson(resolve(inputPath, 'template.json'), 'Template'),
    readJson(resolve(inputPath, 'requirements.json'), 'Requirements manifest'),
    readJson(valuesPath, 'Values map')
  ]);
  const { placeholders } = validatePackage(template, manifest);
  if (!isObject(values)) throw new Error('Values map must be a JSON object keyed by placeholder id');
  const expected = new Set(placeholders);
  const supplied = Object.keys(values);
  const missing = placeholders.filter(id => !Object.hasOwn(values, id));
  const extra = supplied.filter(id => !expected.has(id));
  if (missing.length || extra.length) throw new Error(`Values map keys do not match requirements (missing: ${missing.length}, extra: ${extra.length})`);
  const config = materialize(template.config, values);
  validateConfig(config);
  if (await pathExists(outputPath)) throw new Error(`Refusing to overwrite existing output file: ${outputPath}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, jsonBytes(config), { flag: 'wx', mode: 0o600 });
  return { status: 'imported', collection: template.collection, serverCount: Object.keys(config[template.collection]).length,
    materializedValueCount: supplied.length, outputPath };
}

export const importTransferConfig = importConfig;

async function main(argv) {
  const options = parseTransferArgs(argv);
  return options.operation === 'export' ? exportConfig(options) : importConfig(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => { process.stderr.write(`Transfer failed: ${error.message}\n`); process.exitCode = 1; });
}

