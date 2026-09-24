# Changelog

All notable changes to this project are documented here. This project follows semantic versioning while recognizing that pre-1.0 releases may introduce breaking changes.

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
