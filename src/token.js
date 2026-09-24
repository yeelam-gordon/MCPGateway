import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const aclTimeoutMs = 5_000;
const windowsAclScript = String.raw`$ErrorActionPreference = 'Stop'
$payloadBase64 = '__PAYLOAD__'
$payload = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadBase64)))
$target = [string]$payload.path
$isDirectory = [bool]$payload.directory
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sections = [Security.AccessControl.AccessControlSections]::Access -bor [Security.AccessControl.AccessControlSections]::Owner
if ($isDirectory) {
  $item = [IO.DirectoryInfo]::new($target)
  $security = [IO.FileSystemAclExtensions]::GetAccessControl($item, $sections)
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
} else {
  $item = [IO.FileInfo]::new($target)
  $security = [IO.FileSystemAclExtensions]::GetAccessControl($item, $sections)
  $inheritance = [Security.AccessControl.InheritanceFlags]::None
}
$rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
$expectedRights = [Security.AccessControl.FileSystemRights]::FullControl
$expectedPropagation = [Security.AccessControl.PropagationFlags]::None
$alreadySecure = $security.AreAccessRulesProtected -and $security.GetOwner([Security.Principal.SecurityIdentifier]).Equals($sid) -and $rules.Count -eq 1
if ($alreadySecure) {
  $rule = $rules[0]
  $alreadySecure = $rule.IdentityReference.Equals($sid) -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $rule.FileSystemRights -eq $expectedRights -and $rule.InheritanceFlags -eq $inheritance -and $rule.PropagationFlags -eq $expectedPropagation
}
if ($alreadySecure) { exit 0 }
$security.SetAccessRuleProtection($true, $false)
foreach ($rule in @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
  [void]$security.RemoveAccessRuleSpecific($rule)
}
$security.SetOwner($sid)
$newRule = [Security.AccessControl.FileSystemAccessRule]::new($sid, $expectedRights, $inheritance, $expectedPropagation, [Security.AccessControl.AccessControlType]::Allow)
[void]$security.AddAccessRule($newRule)
[IO.FileSystemAclExtensions]::SetAccessControl($item, $security)`;

async function secureOwnerOnly(path, directory) {
  if (process.platform !== 'win32') {
    await chmod(path, directory ? 0o700 : 0o600);
    return;
  }
  const payload = Buffer.from(JSON.stringify({ path, directory }), 'utf8').toString('base64');
  const encodedCommand = Buffer.from(windowsAclScript.replace('__PAYLOAD__', payload), 'utf16le').toString('base64');
  const options = { windowsHide: true, timeout: aclTimeoutMs };
  let lastError;
  for (const shell of ['pwsh.exe', 'powershell.exe']) {
    try {
      await execFileAsync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], options);
      return;
    } catch (error) {
      lastError = error;
      if (error.code === 'ENOENT' && shell === 'pwsh.exe') continue;
      break;
    }
  }
  throw new Error(`Cannot apply owner-only ACL to ${path}: ${lastError?.message ?? 'no PowerShell executable found'}`, { cause: lastError });
}

export async function loadOrCreateToken(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await secureOwnerOnly(stateDir, true);
  const path = join(stateDir, 'owner.token');
  try {
    await access(path);
    await secureOwnerOnly(path, false);
    const token = (await readFile(path, 'utf8')).trim();
    if (!token) throw new Error(`Owner token file is empty: ${path}`);
    return { token, path };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = randomBytes(32).toString('base64url');
  const file = await open(path, 'wx', 0o600);
  try {
    await secureOwnerOnly(path, false);
    await file.writeFile(`${token}\n`, 'utf8');
  } finally {
    await file.close();
  }
  return { token, path };
}
