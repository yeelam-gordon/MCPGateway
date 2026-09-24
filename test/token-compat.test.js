import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

async function inspectAcl(shell, path, directory) {
  const payload = Buffer.from(JSON.stringify({ path, directory }), 'utf8').toString('base64');
  const script = String.raw`$payload = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')))
$item = if ([bool]$payload.directory) { [IO.DirectoryInfo]::new([string]$payload.path) } else { [IO.FileInfo]::new([string]$payload.path) }
$acl = if ($PSVersionTable.PSEdition -eq 'Desktop') { $item.GetAccessControl() } else { [IO.FileSystemAclExtensions]::GetAccessControl($item) }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [pscustomobject]@{
    sid = $_.IdentityReference.Value
    type = [int]$_.AccessControlType
    rights = [int]$_.FileSystemRights
    inheritance = [int]$_.InheritanceFlags
    propagation = [int]$_.PropagationFlags
  }
})
[pscustomobject]@{
  owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  current = $sid.Value
  protected = $acl.AreAccessRulesProtected
  rules = $rules
} | ConvertTo-Json -Compress -Depth 4`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 5_000 });
  return JSON.parse(stdout.trim());
}

function assertOwnerOnlyAcl(acl, inheritance) {
  assert.equal(acl.owner, acl.current);
  assert.equal(acl.protected, true);
  assert.equal(acl.rules.length, 1);
  assert.deepEqual(acl.rules[0], {
    sid: acl.current,
    type: 0,
    rights: 2032127,
    inheritance,
    propagation: 0
  });
}

async function loadWithShellRoute(route, stateDir) {
  const childProcess = require('node:child_process');
  const originalExecFile = childProcess.execFile;
  const invocations = [];
  childProcess.execFile = function routedExecFile(file, args, options, callback) {
    invocations.push(file);
    if (file === 'pwsh.exe' && route === 'powershell') {
      queueMicrotask(() => callback(Object.assign(new Error('spawn pwsh.exe ENOENT'), { code: 'ENOENT' })));
      return undefined;
    }
    return originalExecFile.call(this, file, args, options, callback);
  };
  syncBuiltinESMExports();
  try {
    const { loadOrCreateToken } = await import(`../src/token.js?route=${route}-${Date.now()}-${Math.random()}`);
    const first = await loadOrCreateToken(stateDir);
    const second = await loadOrCreateToken(stateDir);
    assert.deepEqual(second, first);
    return { result: first, invocations };
  } finally {
    childProcess.execFile = originalExecFile;
    syncBuiltinESMExports();
  }
}


test('concurrent first token loads converge while the winner has created but not written', { timeout: 10_000 }, async () => {
  const fsPromises = require('node:fs/promises');
  const originalOpen = fsPromises.open;
  const originalReadFile = fsPromises.readFile;
  let releaseWrite;
  const writeReleased = new Promise(resolve => { releaseWrite = resolve; });
  let resolveEmptyRead;
  const emptyReadObserved = new Promise(resolve => { resolveEmptyRead = resolve; });
  let delayedCreate = true;
  let delayedRead = true;

  fsPromises.open = async function delayedOpen(path, flags, mode) {
    const file = await originalOpen.call(this, path, flags, mode);
    if (flags !== 'wx' || !delayedCreate) return file;
    delayedCreate = false;
    return {
      writeFile: async (...args) => {
        await writeReleased;
        return file.writeFile(...args);
      },
      close: (...args) => file.close(...args)
    };
  };
  fsPromises.readFile = async function observedReadFile(path, ...args) {
    const value = await originalReadFile.call(this, path, ...args);
    if (delayedRead && String(path).endsWith('owner.token') && value.toString().trim() === '') {
      delayedRead = false;
      resolveEmptyRead();
    }
    return value;
  };
  syncBuiltinESMExports();

  const root = await mkdtemp(join(tmpdir(), 'mcp-gateway-token-race-'));
  try {
    const { loadOrCreateToken } = await import(`../src/token.js?race=${Date.now()}-${Math.random()}`);
    const loads = Array.from({ length: 8 }, () => loadOrCreateToken(root));
    await emptyReadObserved;
    releaseWrite();
    const results = await Promise.all(loads);
    assert.equal(new Set(results.map(result => result.token)).size, 1);
    assert.equal(new Set(results.map(result => result.path)).size, 1);

    await fsPromises.writeFile(results[0].path, '');
    await assert.rejects(() => loadOrCreateToken(root), error => {
      assert.equal(error.message, `Owner token file is empty: ${results[0].path}`);
      return true;
    });
    assert.equal(await originalReadFile(results[0].path, 'utf8'), '');
  } finally {
    releaseWrite();
    fsPromises.open = originalOpen;
    fsPromises.readFile = originalReadFile;
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows token ACL supports PowerShell 7 and Windows PowerShell 5.1 fallback', { skip: process.platform !== 'win32', timeout: 30_000 }, async t => {
  for (const route of ['pwsh', 'powershell']) {
    await t.test(route === 'pwsh' ? 'uses PowerShell 7 when available' : 'falls back to Windows PowerShell 5.1 when pwsh is unavailable', async () => {
      const root = await mkdtemp(join(tmpdir(), 'mcp gateway token compat '));
      const stateDir = join(root, 'state with spaces \u6e2c\u8a66');
      try {
        const { result, invocations } = await loadWithShellRoute(route, stateDir);
        assert.equal(invocations[0], 'pwsh.exe');
        if (route === 'pwsh') {
          assert.equal(invocations.includes('powershell.exe'), false);
        } else {
          assert.equal(invocations.includes('powershell.exe'), true);
        }
        assertOwnerOnlyAcl(await inspectAcl(route === 'pwsh' ? 'pwsh.exe' : 'powershell.exe', stateDir, true), 3);
        assertOwnerOnlyAcl(await inspectAcl(route === 'pwsh' ? 'pwsh.exe' : 'powershell.exe', result.path, false), 0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('falls back when pwsh exists but cannot be executed', async () => {
    const childProcess = require('node:child_process');
    const originalExecFile = childProcess.execFile;
    const invocations = [];
    childProcess.execFile = function unavailableExecFile(file, args, options, callback) {
      invocations.push(file);
      queueMicrotask(() => file === 'pwsh.exe'
        ? callback(Object.assign(new Error('spawn pwsh.exe EACCES'), { code: 'EACCES' }))
        : callback(null, '', ''));
      return undefined;
    };
    syncBuiltinESMExports();
    const root = await mkdtemp(join(tmpdir(), 'mcp-gateway-token-unavailable-'));
    try {
      const { loadOrCreateToken } = await import(`../src/token.js?unavailable=${Date.now()}`);
      await loadOrCreateToken(join(root, 'state'));
      assert.deepEqual(invocations, ['pwsh.exe', 'powershell.exe', 'pwsh.exe', 'powershell.exe']);
    } finally {
      childProcess.execFile = originalExecFile;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('surfaces PowerShell 7 ACL failures without changing shell semantics', async () => {
    const childProcess = require('node:child_process');
    const originalExecFile = childProcess.execFile;
    const invocations = [];
    childProcess.execFile = function failingExecFile(file, args, options, callback) {
      invocations.push(file);
      queueMicrotask(() => callback(Object.assign(new Error('ACL command failed'), { code: 1 })));
      return undefined;
    };
    syncBuiltinESMExports();
    const root = await mkdtemp(join(tmpdir(), 'mcp-gateway-token-error-'));
    try {
      const { loadOrCreateToken } = await import(`../src/token.js?failure=${Date.now()}`);
      await assert.rejects(() => loadOrCreateToken(join(root, 'state')), error => {
        assert.match(error.message, /Cannot apply owner-only ACL/);
        assert.equal(error.cause?.message, 'ACL command failed');
        return true;
      });
      assert.deepEqual(invocations, ['pwsh.exe']);
    } finally {
      childProcess.execFile = originalExecFile;
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });
});
