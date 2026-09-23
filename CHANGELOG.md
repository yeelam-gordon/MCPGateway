# Changelog

All notable changes to this project are documented here. This project follows semantic versioning while recognizing that pre-1.0 releases may introduce breaking changes.

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
