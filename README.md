# MCP PostgreSQL Server

A Model Context Protocol (MCP) server that provides PostgreSQL database access and operations.

## Installation

You can use this MCP server with any MCP-compatible client by installing it via npm:

```bash
npm install -g mcp-postgres
```

Or run it directly with npx:

```bash
npx mcp-postgres@latest
```

## Configuration

### MCP Client Configuration

Add this to your MCP client configuration (e.g., `.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["mcp-postgres@latest"],
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_USER": "postgres",
        "DB_PASSWORD": "your_password",
        "DB_NAME": "your_database",
        "DB_SSL_MODE": "require"
      },
      "disabled": false,
      "autoApprove": ["list_tables", "get_schema"]
    }
  }
}
```

Alternative using DATABASE_URL:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["mcp-postgres@latest"],
      "env": {
        "DATABASE_URL": "postgresql://username:password@localhost:5432/database_name?sslmode=require"
      },
      "disabled": false,
      "autoApprove": ["list_tables", "get_schema"]
    }
  }
}
```

### Environment Variables

The server supports multiple configuration methods:

#### Option 1: Individual Environment Variables (Recommended)

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
DB_SSL_MODE=require       # Optional: require, disable, or omit for default
DB_READ_ONLY=true         # Optional: disables all write and DDL tools server-side
DB_STATEMENT_TIMEOUT=30000  # Optional: query timeout in ms (default: 30000)

# Optional authorize-before-mutate (default OFF)
SQLGUARD_REQUIRE=1          # Fail-closed: write tools need verified Ed25519 PASS
SQLGUARD_BASE=https://sqlguard.io
SQLGUARD_AGENT=0xyourwallet
```

When `SQLGUARD_REQUIRE=1`, mutating tools (`insert_data`, `update_data`, `delete_data`, `execute_raw_query`, `create_table`, `alter_table`) require `sqlguard_certificate` + `sqlguard_signature` args verified via `POST /v1/verify`. Dry-run previews stay free. Lint / `DB_READ_ONLY` alone is not statement authorize.

Wealth unlock for production agents: Exact Pilot Challenge **$100** ([/challenge](https://sqlguard.io/challenge)) or Gateway invoice **$299/mo** → hello@sqlguard.io. Free tip: `POST /v1/gateway/decide`. Probe is free and never authorizes. Docs: https://sqlguard.io/GATEWAY.md

```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
DB_SSL_MODE=require       # Optional: require, disable, or omit for default
DB_READ_ONLY=true         # Optional: disables all write and DDL tools server-side
DB_STATEMENT_TIMEOUT=30000  # Optional: query timeout in ms (default: 30000)
```

Alternative PostgreSQL-style variable names are also supported:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=your_database
POSTGRES_SSL_MODE=require  # Optional: require, disable, or omit for default
```

#### Option 2: DATABASE_URL (Fallback)

```bash
DATABASE_URL=postgresql://username:password@localhost:5432/database_name?sslmode=require
```

#### Option 3: Config File

Create a `config.json` file in your working directory:

```json
{
  "db": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "your_password",
    "database": "your_database",
    "sslmode": "require"
  }
}
```

### SSL Configuration

The server supports SSL connections with the following modes:

- `require` - Forces SSL connection (useful for cloud databases)
- `disable` - Explicitly disables SSL (default for local development)
- Omit the SSL mode for default behavior (no SSL)

SSL can be configured via:

- Environment variables: `DB_SSL_MODE` or `POSTGRES_SSL_MODE`
- DATABASE_URL parameter: `?sslmode=require`
- Config file: `"sslmode": "require"`

#### AWS RDS Auto-Configuration

The server automatically detects AWS RDS endpoints (hosts containing `.rds.amazonaws.com`) and:

1. **Automatically downloads** the AWS RDS Global Certificate Bundle from `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`
2. **Caches the certificate** locally in `.aws-certs/` directory for 30 days
3. **Configures SSL** with proper certificate validation using the downloaded bundle
4. **Re-downloads** the certificate automatically if it's older than 30 days
5. **Graceful fallback** to basic SSL if certificate download fails

This means you can connect to AWS RDS instances without manually downloading or configuring SSL certificates. Simply provide your RDS endpoint and the server handles the rest:

```bash
DB_HOST=mydb.cluster-xyz.us-east-1.rds.amazonaws.com
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
# No need to set DB_SSL_MODE - automatically configured for RDS
```

**Features:**

- **Persistent disk caching**: Certificate is saved to `.aws-certs/rds-global-bundle.pem` and persists between sessions
- **30-day cache duration**: Certificate is automatically refreshed after 30 days
- **Cache validation**: Verifies cached certificates aren't corrupted before use
- **Connection retry**: Automatic retry logic with 3 attempts and 2-second delays
- **Error handling**: Falls back to basic SSL if certificate download fails
- **Performance**: Certificate is cached in memory after first read to avoid repeated file operations
- **Cache monitoring**: Use the `check_certificate_cache` tool to view cache status

The auto-configuration ensures secure, verified connections to AWS RDS while maintaining convenience and reliability.

## Available Tools

### `list_tables`

Lists all tables in the database with their types.

### `get_schema`

Gets database schema information including tables and columns.

- Optional parameter: `table_name` - Get schema for a specific table

### `execute_query`

Executes a SQL query (SELECT statements only for safety).

- Required parameter: `query` - The SQL SELECT query to execute

### `describe_table`

Get detailed information about a specific table including indexes and constraints.

- Required parameter: `table_name` - Name of the table to describe

### `get_table_sample`

Gets a sample of rows from a table.

- Required parameter: `table_name` - Name of the table to sample
- Optional parameter: `limit` - Number of rows to return (default: 10, max: 100)

### `check_certificate_cache`

Checks the status of the AWS RDS certificate cache.

- Shows cache location, age, expiration status, and file details
- Useful for troubleshooting SSL connection issues with RDS

## Security

### Read-Only Mode

Set `DB_READ_ONLY=true` to disable all write and DDL tools at the server level. When enabled, the following tools are hidden from the tool list and will return an error if called:

- `update_data`
- `delete_data`
- `insert_data`
- `execute_raw_query`
- `create_table`
- `alter_table`

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["mcp-postgres@latest"],
      "env": {
        "DB_HOST": "localhost",
        "DB_READ_ONLY": "true",
        ...
      },
      "autoApprove": ["list_tables", "get_schema"]
    }
  }
}
```

This is enforced server-side — it cannot be bypassed by the MCP client, and is independent of the client's `autoApprove` list.

### Least-Privilege Database Roles (Recommended)

For defence in depth, connect with a PostgreSQL user that only has the permissions it needs. Even with `DB_READ_ONLY=true`, using a restricted database role ensures the server cannot accidentally or maliciously access data beyond its scope.

**Read-only role** (schema inspection + SELECT):

```sql
CREATE ROLE mcp_readonly WITH LOGIN PASSWORD 'strong_password';
-- Allow connecting to the database
GRANT CONNECT ON DATABASE your_database TO mcp_readonly;
-- Allow reading schema metadata
GRANT USAGE ON SCHEMA public TO mcp_readonly;
-- Allow SELECT on all current tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;
-- Allow SELECT on future tables too
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;
```

**Read-write role** (no DDL):

```sql
CREATE ROLE mcp_readwrite WITH LOGIN PASSWORD 'strong_password';
GRANT CONNECT ON DATABASE your_database TO mcp_readwrite;
GRANT USAGE ON SCHEMA public TO mcp_readwrite;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mcp_readwrite;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mcp_readwrite;
```

This role can use all tools except `create_table`, `alter_table`, and `execute_raw_query` (which can run DDL). Consider whether those tools are needed and restrict accordingly.

**What to avoid:** connecting as a superuser (`postgres`) or a user with `CREATEDB` / `CREATEROLE` privileges. If `execute_raw_query` is enabled, a superuser connection has no effective guardrails.

### Query Safety

Only SELECT queries are allowed through the `query_data` tool. The `execute_raw_query` tool has no such restriction — disable it via `DB_READ_ONLY=true` or use a role without write permissions if you don't need it.

## Testing

### Testing with MCP Inspector

You can test the server locally using the MCP Inspector tool:

```powershell
# Install the MCP inspector
npm install -g @modelcontextprotocol/inspector

# Set your database credentials
$env:DB_HOST="localhost"
$env:DB_USER="postgres"
$env:DB_PASSWORD="your_password"
$env:DB_NAME="your_database"

# Run the inspector
mcp-inspector node server.mjs
```

The inspector opens a web UI where you can interactively test each tool and see the responses.

### Testing in Kiro IDE

Once configured in your `.kiro/settings/mcp.json`, you can test the tools directly:

- "List all tables in the database"
- "Show me the schema for the users table"
- "Execute this query: SELECT \* FROM products WHERE price > 100"

## License

MIT
