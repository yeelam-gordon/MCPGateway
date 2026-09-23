# Contributing

Thank you for helping improve Shared MCP Gateway.

## Development

Use Node.js 24. From the repository root:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Keep paths portable across Ubuntu and Windows. In particular, test paths containing spaces and avoid assumptions about shell quoting or path separators.

## Changes and tests

- Add focused unit or integration tests with local fixtures. Tests must not require live MCP backends, network credentials, private data, or developer-specific configuration.
- Include evidence that covers the behavior changed, including failure and cleanup paths where relevant.
- Keep schemas and public behavior explicit. API or configuration changes need compatibility analysis, migration guidance, and maintainer review.
- Preserve dependency hygiene: prefer existing platform or project capabilities, keep dependency ranges intentional, and explain new runtime dependencies.
- Do not add a formatter or formatting dependency solely for a contribution. Follow the surrounding style.

Run the full test command before opening a pull request. Describe user-visible changes, security implications, compatibility impact, and any required restart or migration steps.
## Engineering references

These upstream examples informed the repository's proportionate release checks; they are references, not additional project requirements:

- [GitHub MCP Server CI](https://github.com/github/github-mcp-server/blob/85598ba6e1256f7ebf4867b95d63b833c4549264/.github/workflows/go.yml) for multi-platform CI and pinned workflow dependencies.
- [Playwright MCP publish workflow](https://github.com/microsoft/playwright-mcp/blob/f1257a5a67aff872f947fae274759f7d54853862/.github/workflows/publish.yml) for release-version consistency checks.
- [Model Context Protocol TypeScript SDK dependency policy](https://github.com/modelcontextprotocol/typescript-sdk/blob/7f7a94c22017e121a960e071bb50ec75e34450bd/DEPENDENCY_POLICY.md) for dependency hygiene and review principles.

