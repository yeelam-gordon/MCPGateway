[CmdletBinding()]
param(
    [string]$ConfigPath = "$HOME\.shared-mcp-gateway\backends.json",
    [string]$StateDir = "$HOME\.shared-mcp-gateway",
    [string]$AdaptersPath,
    [ValidateRange(1, 65535)]
    [int]$Port = 7319
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$client = [System.Net.Sockets.TcpClient]::new()
$occupied = $false
try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    $occupied = $task.Wait(300) -and $client.Connected
} catch {
    $occupied = $false
} finally {
    $client.Dispose()
}
if ($occupied) {
    throw "Port $Port is already in use. This launcher will not stop or replace the existing process."
}

Write-Host "Starting the shared MCP gateway in the foreground on 127.0.0.1:$Port. Press Ctrl+C to stop it."
$gatewayArgs = @(
    (Join-Path $projectRoot 'src\cli.js'),
    '--config', ([IO.Path]::GetFullPath($ConfigPath)),
    '--port', [string]$Port,
    '--state-dir', ([IO.Path]::GetFullPath($StateDir))
)
if ($AdaptersPath) {
    $gatewayArgs += @('--adapters', [IO.Path]::GetFullPath($AdaptersPath))
}
& node @gatewayArgs
exit $LASTEXITCODE
