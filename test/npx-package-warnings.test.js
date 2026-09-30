import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectNpxPackageWarnings } from '../src/npx-package-warnings.js';

test('npx package diagnostics skip long and short workspace option values', () => {
  const warnings = collectNpxPackageWarnings({
    longWorkspace: { command: 'npx', args: ['--workspace', 'docs-workspace', 'github-mcp-server@latest'] },
    shortWorkspace: { command: 'npx.cmd', args: ['-w', 'api-workspace', 'github-mcp-server@next'] }
  });

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /mutable registry package spec `github-mcp-server@latest`/);
  assert.match(warnings[1], /mutable registry package spec `github-mcp-server@next`/);
  assert.equal(warnings.some(value => value.includes('docs-workspace')), false);
  assert.equal(warnings.some(value => value.includes('api-workspace')), false);
});

test('npx package diagnostics skip separate registry and loglevel values before the package spec', () => {
  const warnings = collectNpxPackageWarnings({
    registry: { command: 'npx', args: ['--registry', 'https://registry.example.invalid', 'github-mcp-server@latest'] },
    loglevel: { command: 'npx.cmd', args: ['--loglevel', 'notice', 'github-mcp-server@next'] }
  });

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /mutable registry package spec `github-mcp-server@latest`/);
  assert.match(warnings[1], /mutable registry package spec `github-mcp-server@next`/);
  assert.equal(warnings.some(value => value.includes('registry.example.invalid')), false);
  assert.equal(warnings.some(value => value.includes('notice')), false);
});

test('npm exec and x diagnostics recognize package flags and positional mutable specs', () => {
  const warnings = collectNpxPackageWarnings({
    execPackage: { command: 'npm', args: ['exec', '--package', 'github-mcp-server@latest', '--', 'github-mcp-server'] },
    shorthandPackage: { command: 'npm.cmd', args: ['x', '-p', '@modelcontextprotocol/server-github@next', '--', 'github-mcp-server'] },
    positionalExec: { command: 'npm.cmd', args: ['exec', 'github-mcp-server@next'] },
    positionalShorthand: { command: 'npm', args: ['x', '@scope/demo@latest'] },
    exact: { command: 'npm', args: ['exec', 'github-mcp-server@1.2.3'] }
  });

  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /`execPackage` launches via `npm exec` with mutable registry package spec `github-mcp-server@latest`/);
  assert.match(warnings[1], /`shorthandPackage` uses deprecated package `@modelcontextprotocol\/server-github@next` via `npm exec`/);
  assert.match(warnings[2], /`positionalExec` launches via `npm exec` with mutable registry package spec `github-mcp-server@next`/);
  assert.match(warnings[3], /`positionalShorthand` launches via `npm exec` with mutable registry package spec `@scope\/demo@latest`/);
});

test('package diagnostics handle prefixes, executable paths, and spaced ranges', () => {
  const warnings = collectNpxPackageWarnings({
    npxPrefix: { command: 'npx', args: ['--prefix', 'C:\\repo\\workspace', 'github-mcp-server@latest'] },
    npmPrefix: { command: 'npm', args: ['--prefix', '/repo/workspace', 'exec', 'github-mcp-server@next'] },
    unixPath: { command: '/usr/local/bin/npx', args: ['github-mcp-server@latest'] },
    windowsPath: { command: 'C:\\Program Files\\nodejs\\npm.cmd', args: ['exec', 'github-mcp-server@next'] },
    spacedRange: { command: 'npx', args: ['github-mcp-server@>=1.0.0 <2.0.0'] }
  });

  assert.equal(warnings.length, 5);
  assert.match(warnings[0], /mutable registry package spec `github-mcp-server@latest`/);
  assert.match(warnings[1], /mutable registry package spec `github-mcp-server@next`/);
  assert.match(warnings[2], /mutable registry package spec `github-mcp-server@latest`/);
  assert.match(warnings[3], /mutable registry package spec `github-mcp-server@next`/);
  assert.match(warnings[4], /mutable registry package spec `github-mcp-server@>=1\.0\.0 <2\.0\.0`/);
  assert.equal(warnings.some(value => value.includes('repo\\workspace') || value.includes('/repo/workspace')), false);
});
