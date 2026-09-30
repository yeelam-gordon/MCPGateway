const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PACKAGE_LAUNCH_FLAGS_WITH_VALUES = new Set([
  '-c', '--call', '-p', '--package', '--cache', '--shell', '--script-shell',
  '--userconfig', '--npm', '--node-options', '--workspace', '-w', '--registry', '--loglevel'
]);
const DEPRECATED_GITHUB_PACKAGE = '@modelcontextprotocol/server-github';
const MAINTAINED_GITHUB_PACKAGE = 'github-mcp-server';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathLike(spec) {
  return spec.includes('\\') || /^\.{1,2}(?:[\\/]|$)|^[\\/]|^[A-Za-z]:[\\/]|^\\\\/.test(spec);
}

function externalSpec(spec) {
  return /^(?:https?:|git(?:\+|:)|ssh:|github:|gitlab:|bitbucket:|gist:|file:|workspace:|link:|portal:|patch:|npm:)/i.test(spec)
    || /^git@/i.test(spec);
}

function splitRegistryPackageSpec(spec) {
  if (typeof spec !== 'string' || spec.length === 0 || /\s/.test(spec) || pathLike(spec) || externalSpec(spec)) return null;
  const scoped = spec.match(/^(@[^/]+\/[^/@]+)(?:@(.+))?$/);
  if (scoped) return { name: scoped[1], version: scoped[2] ?? null, spec };
  const unscoped = spec.match(/^([^@/][^@/\s]*)(?:@(.+))?$/);
  if (!unscoped) return null;
  return { name: unscoped[1], version: unscoped[2] ?? null, spec };
}

function versionState(spec) {
  if (spec.version === null) return 'unversioned';
  if (pathLike(spec.version) || externalSpec(spec.version)) return null;
  return EXACT_SEMVER.test(spec.version) ? 'exact' : 'mutable';
}

function quoted(spec) {
  return `\`${spec}\``;
}

function packageGuidance(name) {
  return `${quoted(`${name}@<exact-version>`)}`
    + ' so registry installs stay reproducible.';
}

function deprecatedGithubWarning(alias, spec, state, launcher) {
  const packageSpec = state === 'exact' ? quoted(DEPRECATED_GITHUB_PACKAGE) : quoted(spec.spec);
  const pinning = state === 'exact' ? '' : ' and pin an exact version';
  return `Backend \`${alias}\` uses deprecated package ${packageSpec} via ${quoted(launcher)}. Replace it with the maintained `
    + `${quoted(MAINTAINED_GITHUB_PACKAGE)} package${pinning}, for example ${packageGuidance(MAINTAINED_GITHUB_PACKAGE)}`;
}

function genericWarning(alias, spec, state, launcher) {
  const action = state === 'unversioned'
    ? `launches via ${quoted(launcher)} with unpinned registry package spec ${quoted(spec.spec)}. Pin an exact version, for example `
    : `launches via ${quoted(launcher)} with mutable registry package spec ${quoted(spec.spec)}. Replace tags or ranges with an exact version, for example `;
  return `Backend \`${alias}\` ${action}${packageGuidance(spec.name)}`;
}

function packageSpecsFromArgs(args) {
  const flagged = [];
  let commandSpec = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      if (commandSpec === null && typeof args[index + 1] === 'string') commandSpec = args[index + 1];
      break;
    }
    if (argument === '-p' || argument === '--package') {
      if (typeof args[index + 1] === 'string') flagged.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith('--package=')) {
      flagged.push(argument.slice('--package='.length));
      continue;
    }
    if (argument.startsWith('-p=')) {
      flagged.push(argument.slice(3));
      continue;
    }
    if (argument.startsWith('-')) {
      if (PACKAGE_LAUNCH_FLAGS_WITH_VALUES.has(argument)) index += 1;
      continue;
    }
    if (commandSpec === null) commandSpec = argument;
    break;
  }
  return flagged.length > 0 ? flagged : commandSpec === null ? [] : [commandSpec];
}

function packageSpecs(command, args) {
  if (/^(npx|npx\.cmd)$/i.test(command)) return { launcher: 'npx', specs: packageSpecsFromArgs(args) };
  if (!/^(npm|npm\.cmd)$/i.test(command)) return null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') break;
    if (argument === 'exec' || argument === 'x') return { launcher: 'npm exec', specs: packageSpecsFromArgs(args.slice(index + 1)) };
    if (argument.startsWith('-')) {
      if (PACKAGE_LAUNCH_FLAGS_WITH_VALUES.has(argument)) index += 1;
      continue;
    }
    return null;
  }
  return null;
}

export function mergeWarnings(...groups) {
  const warnings = [];
  const seen = new Set();
  for (const group of groups) {
    for (const warning of group ?? []) {
      if (typeof warning !== 'string' || seen.has(warning)) continue;
      seen.add(warning);
      warnings.push(warning);
    }
  }
  return Object.freeze(warnings);
}

export function collectNpxPackageWarnings(backends) {
  if (!object(backends)) return Object.freeze([]);
  const warnings = [];
  for (const [alias, entry] of Object.entries(backends)) {
    if (entry?.disabled) continue;
    if (!object(entry) || typeof entry.command !== 'string') continue;
    const args = Array.isArray(entry.args) ? entry.args.filter(argument => typeof argument === 'string') : [];
    const parsed = packageSpecs(entry.command, args);
    if (!parsed) continue;
    for (const rawSpec of parsed.specs) {
      const spec = splitRegistryPackageSpec(rawSpec);
      if (!spec) continue;
      const state = versionState(spec);
      if (state === null || state === 'exact') {
        if (spec.name === DEPRECATED_GITHUB_PACKAGE) warnings.push(deprecatedGithubWarning(alias, spec, 'exact', parsed.launcher));
        continue;
      }
      warnings.push(spec.name === DEPRECATED_GITHUB_PACKAGE
        ? deprecatedGithubWarning(alias, spec, state, parsed.launcher)
        : genericWarning(alias, spec, state, parsed.launcher));
    }
  }
  return mergeWarnings(warnings);
}
