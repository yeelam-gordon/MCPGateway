const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.rb', '.jar', '.ps1', '.sh']);
const SCRIPT_RUNTIMES = new Set(['node', 'node.exe', 'bun', 'bun.exe', 'deno', 'deno.exe', 'python', 'python.exe', 'python3', 'python3.exe', 'ruby', 'ruby.exe', 'java', 'java.exe', 'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'bash', 'sh']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function absolutePath(value) {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value));
}

function pathLike(value) {
  return typeof value === 'string' && (/^\.\.?[\\/]/.test(value) || /[\\/]/.test(value));
}

function extension(value) {
  if (typeof value !== 'string') return '';
  const clean = value.split(/[?#]/, 1)[0];
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index).toLowerCase() : '';
}

function runtimeName(command) {
  if (typeof command !== 'string') return '';
  const pieces = command.split(/[\\/]/);
  return pieces[pieces.length - 1].toLowerCase();
}

function hasRelativeScriptArgument(entry) {
  if (!Array.isArray(entry.args)) return false;
  for (const argument of entry.args) {
    if (typeof argument !== 'string' || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(argument)) continue;
    const candidate = argument.startsWith('-') && argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
    if (candidate.startsWith('-') || absolutePath(candidate)) continue;
    if (pathLike(candidate)) return true;
    if (SCRIPT_RUNTIMES.has(runtimeName(entry.command)) && SCRIPT_EXTENSIONS.has(extension(candidate))) return true;
  }
  return false;
}

export function assertPortableBackendPaths(config) {
  if (!object(config) || !object(config.mcpServers)) throw new Error('Canonical backend config must contain mcpServers before path validation.');
  for (const entry of Object.values(config.mcpServers)) {
    if (!object(entry) || entry.url !== undefined) continue;
    if (entry.cwd !== undefined && !absolutePath(entry.cwd))
      throw new Error('Migrated local backends require cwd to be an explicit absolute Windows or POSIX path.');
    if (absolutePath(entry.cwd)) continue;
    if (pathLike(entry.command) && !absolutePath(entry.command))
      throw new Error('Migrated local backends with relative command paths require an explicit absolute cwd or an absolute command path.');
    if (hasRelativeScriptArgument(entry))
      throw new Error('Migrated local backend script or relative path arguments require an explicit absolute cwd or absolute paths.');
  }
  return config;
}