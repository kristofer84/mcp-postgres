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
DB_SSL_MODE=require  # Optional: require, disable, or omit for default
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

This means you can connect to AWS RDS instances without manually downloading or configuring SSL certificates. Simply provide your RDS endpoint and the server handles the rest:

```bash
DB_HOST=mydb.cluster-xyz.us-east-1.rds.amazonaws.com
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
# No need to set DB_SSL_MODE - automatically configured for RDS
```

The auto-configuration ensures secure, verified connections to AWS RDS while maintaining convenience.

## Available Tools

### `list_tables`

Lists all tables in the database with their types.

### `get_schema`

Gets database schema information including tables and columns.

- Optional parameter: `table_name` - Get schema for a specific table

### `execute_query`

Executes a SQL query (SELECT statements only for safety).

- Required parameter: `query` - The SQL SELECT query to execute

## Security

For security reasons, only SELECT queries are allowed through the `execute_query` tool. This prevents accidental data modification through the MCP interface.

## Example Usage

Once configured, you can use the tools in your MCP client:

- "List all tables in the database"
- "Show me the schema for the users table"
- "Execute this query: SELECT \* FROM products WHERE price > 100"

## License

MIT
