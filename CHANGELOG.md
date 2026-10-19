# Changelog

All notable changes to this project are documented here.

## [1.4.2]

Security release.

### Security
- Read-only mode now enforces `default_transaction_read_only = on` on the database session and runs every `query_data` call inside an explicit `BEGIN TRANSACTION READ ONLY` block. Write-capable functions reached through a `SELECT` can no longer modify data on the current connection.
- In read-only mode, `query_data` now rejects calls to `VOLATILE` PostgreSQL functions. This blocks `dblink_exec()` and similar functions that open a second connection and write outside the current read-only transaction. The check resolves functions through `pg_proc` instead of relying on a function-name denylist.
- Fixed a multi-statement check bypass where a comment marker inside a string literal (for example `SELECT '--'; DROP TABLE users`) was stripped before the string literal, hiding the second statement from `assertSingleSelect()`.
- `assertSingleSelect()` now strips comments, ordinary strings, `E''` strings, and dollar-quoted strings in a single pass, and correctly allows semicolons inside dollar-quoted strings.

### Changed
- The read-only mode log message now also mentions database-session enforcement.
- Documentation clarifies that a SELECT-only database role remains the strongest boundary for read-only deployments.

### Credit
- Thanks to Syed Anas Mohiuddin (Cognivators LLC) for reporting the read-only mode bypass via `dblink_exec` and for suggesting database-enforced read-only.

## [1.4.1]

Stability and quality fixes.

### Changed
- Split the 1,300-line `server.mjs` into focused modules under `src/`: `sql.mjs` (pure helpers), `ssl.mjs`, `config.mjs`, `db.mjs`, and `src/tools/` (schemas plus read and write handlers). `server.mjs` is now a thin entry point that wires the server together.

### Fixed
- The server now reports its real name and version (`mcp-postgres`) instead of the hardcoded `mcp-db-server` 1.0.0.
- Added a timeout to the AWS RDS certificate download, so a stalled download no longer hangs startup.
- Added a connection timeout to the database client, so an unreachable host fails fast.
- Reconnection no longer reads `pg` private fields, and concurrent reconnects are collapsed into one attempt.
- Exit on stdin close. The MCP stdio transport does not emit close on stdin EOF, so the `pg` socket used to keep the process alive as an orphan.

### Added
- Graceful shutdown on `SIGINT`, `SIGTERM`, stdin EOF, and client disconnect.
- `unhandledRejection` and `uncaughtException` handlers.
- Runtime validation for tool arguments, since the client-supplied `inputSchema` is advisory only.
- Unit tests using `node:test` for the pure helpers, run with `npm run test:unit`.
- ESLint with a `lint` script, wired into CI.
- `LICENSE`, `SECURITY.md`, `.nvmrc`, and a Dependabot config.

## [1.4.0]

Maintenance release. No API changes.

### Changed
- Bumped `@modelcontextprotocol/sdk` from 1.20.0 to 1.32.1.
- Bumped `pg` from 8.16.3 to 8.23.1.
- Requires Node.js 22 or newer (`engines.node` is now `>=22.0.0`).

### Security
- Cleared all `npm audit` findings. The previous lockfile had 6 issues (1 critical, 2 high, 3 moderate) in transitive `express` dependencies of the MCP SDK.

### CI
- Test matrix is now Node 22.x and 24.x, dropping EOL Node 18 and 20.
- Bumped `actions/checkout` and `actions/setup-node` to v7.
- Folded the packaging smoke test into `ci.yml` and removed the redundant `build.yml`.

## [1.3.0]
- Accept `data` as an alias for the `values` parameter in `update_data`.
- Fixed semicolon false positive in `query_data` by stripping string literals first.

## [1.2.1]
- Fixed `pg` concurrent query deprecation warning.

## [1.2.0]
- Security hardening: `quoteIdent` for table names, multi-statement query rejection.
- Added `dry_run` support and query timeout.
