import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const aclTimeoutMs = 5_000;
const tokenWriteWaitMs = 2_000;
const tokenWritePollMs = 20;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const windowsAclScript = String.raw`$ErrorActionPreference = 'Stop'
$payloadBase64 = '__PAYLOAD__'
$payload = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadBase64)))
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
foreach ($entry in @($payload.items)) {
$target = [string]$entry.path
$isDirectory = [bool]$entry.directory
if ($isDirectory) {
  $item = [IO.DirectoryInfo]::new($target)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
} else {
  $item = [IO.FileInfo]::new($target)
  $inheritance = [Security.AccessControl.InheritanceFlags]::None
}
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $security = $item.GetAccessControl($sections)
} else {
  $security = [IO.FileSystemAclExtensions]::GetAccessControl($item, $sections)
}
$rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$expectedRights = [Security.AccessControl.FileSystemRights]::FullControl
$expectedPropagation = [Security.AccessControl.PropagationFlags]::None
$alreadySecure = $security.AreAccessRulesProtected -and $security.GetOwner([Security.Principal.SecurityIdentifier]).Equals($sid) -and $rules.Count -eq 1
if ($alreadySecure) {
  $rule = $rules[0]
  $alreadySecure = $rule.IdentityReference.Equals($sid) -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.FileSystemRights -eq $expectedRights -and $rule.InheritanceFlags -eq $inheritance -and $rule.PropagationFlags -eq $expectedPropagation
}
if ($alreadySecure) { continue }
$security.SetAccessRuleProtection($true, $false)
foreach ($rule in @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
  [void]$security.RemoveAccessRuleSpecific($rule)
}
$security.SetOwner($sid)
$newRule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $expectedRights, $inheritance, $expectedPropagation, [Security.AccessControl.AccessControlType]::Allow)
[void]$security.AddAccessRule($newRule)
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $item.SetAccessControl($security)
} else {
  [IO.FileSystemAclExtensions]::SetAccessControl($item, $security)
}
}`;

async function secureOwnerOnly(items) {
  if (process.platform !== 'win32') {
    await Promise.all(items.map(({ path, directory }) => chmod(path, directory ? 0o700 : 0o600)));
    return;
  }
  const payload = Buffer.from(JSON.stringify({ items }), 'utf8').toString('base64');
  const encodedCommand = Buffer.from(windowsAclScript.replace('__PAYLOAD__', payload), 'utf16le').toString('base64');
  const options = { windowsHide: true, timeout: aclTimeoutMs };
  let lastError;
  for (const shell of ['pwsh.exe', 'powershell.exe']) {
    try {
      await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], options);
      return;
    } catch (error) {
      lastError = error;
      if (shell === 'pwsh.exe' && (error.code === 'ENOENT' || error.code === 'EACCES')) continue;
      break;
    }
  }
  throw new Error(`Cannot apply owner-only ACL to ${items.map(item => item.path).join(', ')}: ${lastError?.message ?? 'no PowerShell executable found'}`, { cause: lastError });
}

async function readToken(path, stateDir) {
  await secureOwnerOnly([{ path: stateDir, directory: true }, { path, directory: false }]);
  const deadline = Date.now() + tokenWriteWaitMs;
  do {
    const token = (await readFile(path, 'utf8')).trim();
    if (token) return { token, path };
    if (Date.now() >= deadline) throw new Error(`Owner token file is empty: ${path}`);
    await delay(Math.min(tokenWritePollMs, deadline - Date.now()));
  } while (true);
}

export async function loadOrCreateToken(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, 'owner.token');
  try {
    await access(path);
    return await readToken(path, stateDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await secureOwnerOnly([{ path: stateDir, directory: true }]);
  const token = randomBytes(32).toString('base64url');
  let file;
  try {
    file = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') return readToken(path, stateDir);
    throw error;
  }
  try {
    await secureOwnerOnly([{ path, directory: false }]);
    await file.writeFile(`${token}\n`, 'utf8');
  } finally {
    await file.close();
  }
  return { token, path };
}
