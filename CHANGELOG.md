# Changelog

All notable changes to this project are documented here. This project follows semantic versioning while recognizing that pre-1.0 releases may introduce breaking changes.

## [0.7.0] - 2026-10-01

### Added

- Native MCP OAuth for remote HTTP backends through the official SDK, without requiring Agency: protected-resource and OAuth/OIDC discovery, PKCE, public-client registration, resource binding, and refresh.
- An explicit, bounded browser sign-in helper with private, atomic credential persistence and concurrency-safe refresh. Entra and other providers without dynamic registration use the operator's registered public client ID; tenant and client IDs are never guessed.
- Advisory diagnostics for mutable or unpinned `npx` and `npm exec` package specifications during setup and migration, without changing execution or Copilot-owned approvals.

### Fixed

- Expired credentials, rotated refresh tokens, concurrent sign-ins, and corrected resource metadata recover without losing newer credentials or retaining invalid discovery state.
- Established backend notification streams remain open beyond request deadlines while connection establishment and other HTTP traffic remain bounded.
- Confidential registration responses are rejected, and native OAuth configuration cannot be exported or imported through transfer packages.
- Authentication failures confirmed to reject a tool request before execution no longer unnecessarily block an exclusive backend; ambiguous downstream outcomes retain their existing safeguards.
- Updated transitive dependency resolutions for `fast-uri` and `ip-address`.

## [0.6.1] - 2026-09-28

### Fixed

- Concurrent terminal resume no longer launches process-inspection shells from every lock waiter. Only the lock holder records ownership; abandoned locks still receive provenance-aware recovery.
- Connectors use a shared 60-second startup budget and bounded 5-second authenticated handshakes, allowing simultaneous resumed sessions to reuse one gateway without failing at the former 20-second limit.
- Startup permission checks tolerate loaded Windows shell startup while respecting the coordinator's remaining deadline; standalone permission checks retain their existing limits and fail-closed behavior.
- Stale instance metadata is rechecked under the startup lock instead of rejecting a gateway whose new owner is still publishing its metadata.
- Regression coverage includes twelve independent starters, twelve real connector processes, shell-free live-lock waiting, and recovery after an owner exits during lock initialization.

## [0.6.0] - 2026-09-24

### Added

- Bring another client's MCP connections into the same shared catalog with explicit `--migrate` preview and backed-up apply. Matching aliases and definitions deduplicate; conflicting definitions stop without replacement.
- Migrate supported Claude Code, VS Code, OpenCode, Qwen Code, Kimi, Antigravity CLI JSON, and Codex TOML configurations through the same transaction layer. Different aliases stay separate, and unsupported client-managed authentication or policies fail explicitly.
- Back up both native configuration and shared catalog with hashes and exact restore commands. Report partial publication without silently undoing concurrent changes.
- Preserve non-MCP TOML data through a pinned parser; warn before regenerating comments and formatting, and retain the exact original backup.
- Exercise migration across all seven native formats and prove two SDK clients reuse the same imported connection and local process.

## [0.5.0] - 2026-09-24

### Added

- Setup can preview and import newly added user MCP entries into an existing gateway without a runtime upgrade, with backups, deduplication, and explicit conflict handling.
- Register the same gateway in six additional JSON client formats through one configuration-adapter layer. Codex receives a native CLI registration plan instead of a custom TOML rewrite; registration does not migrate the other client's existing servers.
- Thin Claude and Qwen plugin manifests expose the existing setup skill without embedding another runtime.
- Read the quickstart in English or 15 additional languages, with English remaining the canonical reference.
- Find separate installation and upgrade instructions for every client from the README navigation table.
- Separate CI release gates exercise fresh runtime installation, versioned upgrade and rollback, and recurring configuration synchronization.
- Source-based alternatives comparison distinguishes one client entry, backend resource sharing, and compact tool discovery.

### Fixed

- Runtime publication retries transient Windows file-access failures within a short bounded window, without deleting an existing runtime or changing its permissions.
- Windows PowerShell 5.1 fallback allows a bounded 10-second cold start for owner-only permission checks; PowerShell 7 retains its 5-second limit, and failures still stop setup.
- Recurring sync preserves reserved object-property names as server aliases and refuses configuration changes detected during preparation rather than writing to a stale catalog.

## [0.4.1] - 2026-09-24

### Fixed

- Immediately retrying discovery after its last caller cancels now starts a fresh discovery instead of inheriting the cancelled request.
- Added boundary regressions for stale catalog generations, pending-release uncertainty, and heartbeat failure preserving an unknown-outcome server lock.
- Shortened setup autocomplete text and user-facing setup summaries while retaining approval and recovery instructions.
- Default transfer exports redact all endpoint URLs, including capability paths and signed query strings.
- Runtime reuse verifies packaged file contents rather than trusting only an installation marker.
- Ambiguous post-dispatch HTTP failures retain exclusive ownership until the outcome can be resolved.
- Windows owner-only permissions are applied atomically, avoiding temporary access failures during simultaneous gateway startup.
- Warm Windows permission checks are batched into one process, with tested PowerShell 7 and Windows PowerShell 5.1 handling.
- Existing-installation checks accept equivalent Windows path casing while continuing to reject different locations.
- The first uncertain HTTP failure explains the unknown outcome, lack of retry, and required exclusive-server recovery.

## [0.4.0] - 2026-09-24

### Added

- `claim_server` and `release_server` acquire/release ownership for an entire backend workflow. Discovery reports the `requiresExclusiveAccess` setting; the legacy `playwright` alias remains exclusive by default.
- Single-flight backend catalog loading, bounded discovery, idle session expiry, and session heartbeats.
- Canonical configuration validation shared across gateway entry points.

### Changed

- The public gateway surface remains six meta-tools. `claim_playwright` and `release_playwright` are replaced by `claim_server` and `release_server`, each requiring a `server` argument.
- Running plugin or gateway processes must be restarted or re-adopted to use the 0.4 behavior after an upgrade.

### Security

- Documented the local single-owner trust boundary and clarified that gateway approval does not replace backend authorization.
