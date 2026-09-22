[CmdletBinding()]
param(
    [string]$StateDir = "$HOME\.shared-mcp-gateway",
    [ValidateRange(1, 65535)]
    [int]$Port = 7319
)

$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'connector.mjs') `
    --state-dir ([IO.Path]::GetFullPath($StateDir)) `
    --port $Port `
    --check
exit $LASTEXITCODE
