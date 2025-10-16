# MCP PostgreSQL Server

A Model Context Protocol (MCP) server that provides PostgreSQL database access and operations.

## Installation

You can use this MCP server with any MCP-compatible client by installing it via npm:

```bash
npm install -g mcp-postgres-server
```

Or run it directly with npx:

```bash
npx mcp-postgres-server@latest
```

## Configuration

### MCP Client Configuration

Add this to your MCP client configuration (e.g., `.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["mcp-postgres-server@latest"],
      "env": {
        "DATABASE_URL": "postgresql://username:password@localhost:5432/database_name"
      },
      "disabled": false,
      "autoApprove": ["list_tables", "get_schema"]
    }
  }
}
```

### Environment Variables

The server supports multiple configuration methods:

#### Option 1: DATABASE_URL
```bash
DATABASE_URL=postgresql://username:password@localhost:5432/database_name
```

#### Option 2: Individual Environment Variables
```bash
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=your_database
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
    "database": "your_database"
  }
}
```

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
- "Execute this query: SELECT * FROM products WHERE price > 100"

## License

MIT