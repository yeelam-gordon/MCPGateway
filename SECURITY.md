# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are provided for the latest released version only. Pre-1.0 releases may include breaking changes; upgrade guidance will be included when a security fix requires one.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, credentials, tokens, private configuration, or exploit details in a public issue or discussion.

Use GitHub's private security advisory form: https://github.com/yeelam-gordon/MCPGateway/security/advisories/new. The repository owner must enable private vulnerability reporting for that form to accept external reports. If the form is unavailable, contact the maintainer through their GitHub profile to request a private channel, without including vulnerability details in the initial public message.

Include the affected version, impact, reproduction steps or a minimal proof of concept, relevant configuration, and any suggested mitigation. Remove real secrets and personal data from all evidence.

## Security model

Shared MCP Gateway is intended for one trusted owner running under a normal operating-system user account. That account, its gateway process, token, configuration, and backend credentials form the trust boundary. The gateway is not a multi-tenant isolation boundary and must not be shared by mutually untrusted users.

The gateway's meta-tool approval controls access to gateway operations; it does not grant or replace authorization enforced by an individual backend. Approving `call_tool` broadly permits calls to any downstream tool allowed by the selected backend's configuration, including write tools; it is not a separate CLI approval boundary for every downstream tool. Each backend's credentials, permissions, data handling, and approval requirements still apply.
