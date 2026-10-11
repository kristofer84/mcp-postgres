# Security Policy

## Supported Versions

Only the latest published version of `mcp-postgres` receives security fixes.

## Reporting a Vulnerability

Please do not open a public issue for security problems.

Use GitHub's private reporting instead:

1. Go to the [Security tab](https://github.com/kristofer84/mcp-postgres/security) of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, including steps to reproduce and the impact.

You can expect an initial reply within a few days. Once a fix is released, the
report will be credited unless you ask to stay anonymous.

## Scope

Relevant areas include SQL injection, bypass of read-only mode, and bypass of
the multi-statement query check. Reports about the security posture of the
database you connect to, or about MCP clients, are out of scope.
