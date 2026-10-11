# Changelog

All notable changes to this project are documented here.

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
