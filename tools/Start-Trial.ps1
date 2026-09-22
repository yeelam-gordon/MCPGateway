[CmdletBinding()]
param(
    [string]$ImportConfig = "$HOME\.shared-mcp-gateway\backends.json",
    [string]$GatewayStateDir = "$HOME\.shared-mcp-gateway",
    [Parameter(Mandatory)]
    [string]$RuntimeDir,
    [ValidateRange(1, 65535)]
    [int]$Port = 7319,
    [ValidateSet('Prompt', 'AllowGateway', 'Permissive')]
    [string]$PermissionMode = 'Prompt',
    [switch]$DryRun,
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$CopilotArgs
)

$ErrorActionPreference = 'Stop'
$importPath = [IO.Path]::GetFullPath($ImportConfig)
$gatewayStatePath = [IO.Path]::GetFullPath($GatewayStateDir)
$runtimePath = [IO.Path]::GetFullPath($RuntimeDir)
$connectorPath = Join-Path $PSScriptRoot 'connector.mjs'
$clientConfigPath = Join-Path $runtimePath 'shared-mcp-gateway.client.json'

$source = Get-Content -LiteralPath $importPath -Raw | ConvertFrom-Json
$aliases = @($source.mcpServers.PSObject.Properties.Name)
if ($aliases.Count -eq 0) {
    throw "No mcpServers entries were found in the selected import config."
}

$agencyArgs = @('copilot', '--no-default-mcps', '--no-config-plugins', '--')
$engineArgs = [System.Collections.Generic.List[string]]::new()
foreach ($alias in $aliases) {
    $engineArgs.Add('--disable-mcp-server')
    $engineArgs.Add($alias)
}
$engineArgs.Add('--additional-mcp-config')
$engineArgs.Add("@$clientConfigPath")
if ($PermissionMode -eq 'AllowGateway') {
    $engineArgs.Add('--allow-tool=shared-mcp-gateway')
} elseif ($PermissionMode -eq 'Permissive') {
    $engineArgs.Add('--allow-all')
}
foreach ($argument in $CopilotArgs) {
    $engineArgs.Add($argument)
}

if ($DryRun) {
    Write-Output ((@('agency') + $agencyArgs + $engineArgs) | ConvertTo-Json -Compress)
    Write-Output "Imported aliases disabled: $($aliases.Count)"
    Write-Output "Would generate client config: $clientConfigPath"
    return
}

New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
if (Test-Path -LiteralPath $clientConfigPath) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    Copy-Item -LiteralPath $clientConfigPath -Destination "$clientConfigPath.$stamp.bak"
}
$clientConfig = [ordered]@{
    mcpServers = [ordered]@{
        'shared-mcp-gateway' = [ordered]@{
            command = 'node'
            args = @($connectorPath, '--port', [string]$Port, '--state-dir', $gatewayStatePath)
        }
    }
}
$clientConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $clientConfigPath -Encoding utf8NoBOM

& node $connectorPath --state-dir $gatewayStatePath --port $Port --check
if ($LASTEXITCODE -ne 0) {
    throw "Shared gateway readiness check failed with exit code $LASTEXITCODE"
}
& agency @agencyArgs @engineArgs
exit $LASTEXITCODE
