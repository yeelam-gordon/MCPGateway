const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.rb', '.jar', '.ps1', '.sh']);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function absolutePath(value) {
  return typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value));
}

function pathLike(value) {
  return typeof value === 'string' && (/^[A-Za-z]:/.test(value) || /^\.\.?[\\/]/.test(value) || /[\\/]/.test(value));
}

function extension(value) {
  if (typeof value !== 'string') return '';
  const clean = value.split(/[?#]/, 1)[0];
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index).toLowerCase() : '';
}


function scopedPackageSpecifier(value) {
  return typeof value === 'string' && /^@[^/\\]+\/[^/\\]+(?:@[^/\\]+)?$/.test(value);
}
function argumentValue(value) {
  return typeof value === 'string' && value.startsWith('-') && value.includes('=')
    ? value.slice(value.indexOf('=') + 1) : value;
}
function driveRelative(value) {
  return typeof value === 'string' && /^[A-Za-z]:(?![\\/])/.test(value);
}
function hasRelativeScriptArgument(entry) {
  if (!Array.isArray(entry.args)) return false;
  for (const argument of entry.args) {
    if (typeof argument !== 'string') continue;
    const candidate = argumentValue(argument);
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) continue;
    if (candidate.startsWith('-') || absolutePath(candidate) || scopedPackageSpecifier(candidate)) continue;
    if (pathLike(candidate)) return true;
    if (SCRIPT_EXTENSIONS.has(extension(candidate))) return true;
  }
  return false;
}

export function assertPortableBackendPaths(config) {
  if (!object(config) || !object(config.mcpServers)) throw new Error('Canonical backend config must contain mcpServers before path validation.');
  for (const entry of Object.values(config.mcpServers)) {
    if (!object(entry) || entry.url !== undefined) continue;
    if (driveRelative(entry.command) || entry.args?.some(argument => driveRelative(argumentValue(argument))))
      throw new Error('Migrated local backends cannot use Windows drive-relative commands or arguments; use absolute paths.');
    if (entry.cwd !== undefined && !absolutePath(entry.cwd))
      throw new Error('Migrated local backends require cwd to be an explicit absolute Windows or POSIX path.');
    if (absolutePath(entry.cwd)) continue;
    if ((pathLike(entry.command) || SCRIPT_EXTENSIONS.has(extension(entry.command))) && !absolutePath(entry.command))
      throw new Error('Migrated local backends with relative command paths require an explicit absolute cwd or an absolute command path.');
    if (hasRelativeScriptArgument(entry))
      throw new Error('Migrated local backend script or relative path arguments require an explicit absolute cwd or absolute paths.');
  }
  return config;
}