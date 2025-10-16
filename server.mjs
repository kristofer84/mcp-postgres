#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "pg";

// Load configuration from multiple sources
function loadConfig() {
  // Try environment variables first
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      db: {
        host: url.hostname,
        port: parseInt(url.port) || 5432,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1)
      }
    };
  }

  // Try individual environment variables
  if (process.env.DB_HOST || process.env.POSTGRES_HOST) {
    return {
      db: {
        host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT) || 5432,
        user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
        password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
        database: process.env.DB_NAME || process.env.POSTGRES_DB || 'postgres'
      }
    };
  }

  // Try config file in current directory
  const configPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  // Default configuration
  return {
    db: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres'
    }
  };
}

const config = loadConfig();

// Initialize database connection
const db = new Client(config.db);
await db.connect();

// Create MCP server
const server = new Server(
  {
    name: "mcp-db-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_schema",
        description: "Get database schema information including tables and columns",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Optional: specific table name to get schema for"
            }
          }
        }
      },
      {
        name: "execute_query",
        description: "Execute a SQL query (SELECT only for safety)",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "SQL query to execute (SELECT statements only)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "list_tables",
        description: "List all tables in the database",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "describe_table",
        description: "Get detailed information about a specific table including indexes and constraints",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to describe"
            }
          },
          required: ["table_name"]
        }
      },
      {
        name: "get_table_sample",
        description: "Get a sample of rows from a table",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to sample"
            },
            limit: {
              type: "number",
              description: "Number of rows to return (default: 10, max: 100)",
              default: 10
            }
          },
          required: ["table_name"]
        }
      }
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_schema": {
        let query = `
          SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
        `;

        if (args?.table_name) {
          query += ` AND table_name = $1`;
          const result = await db.query(query, [args.table_name]);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.rows, null, 2)
              }
            ]
          };
        } else {
          const result = await db.query(query);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.rows, null, 2)
              }
            ]
          };
        }
      }

      case "execute_query": {
        const query = args?.query;
        if (!query) {
          throw new Error("Query is required");
        }

        // Safety check - only allow SELECT statements
        const trimmedQuery = query.trim().toLowerCase();
        if (!trimmedQuery.startsWith("select")) {
          throw new Error("Only SELECT queries are allowed for safety");
        }

        const result = await db.query(query);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rows: result.rows,
                rowCount: result.rowCount
              }, null, 2)
            }
          ]
        };
      }

      case "list_tables": {
        const result = await db.query(`
          SELECT table_name, table_type
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rows, null, 2)
            }
          ]
        };
      }

      case "describe_table": {
        const tableName = args?.table_name;
        if (!tableName) {
          throw new Error("Table name is required");
        }

        // Get table info, columns, indexes, and constraints
        const [columns, indexes, constraints] = await Promise.all([
          db.query(`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `, [tableName]),

          db.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = $1
          `, [tableName]),

          db.query(`
            SELECT constraint_name, constraint_type
            FROM information_schema.table_constraints
            WHERE table_schema = 'public' AND table_name = $1
          `, [tableName])
        ]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                columns: columns.rows,
                indexes: indexes.rows,
                constraints: constraints.rows
              }, null, 2)
            }
          ]
        };
      }

      case "get_table_sample": {
        const tableName = args?.table_name;
        const limit = Math.min(args?.limit || 10, 100); // Cap at 100 rows

        if (!tableName) {
          throw new Error("Table name is required");
        }

        // Use parameterized query for table name safety
        const result = await db.query(`
          SELECT * FROM ${tableName.replace(/[^a-zA-Z0-9_]/g, '')} 
          LIMIT $1
        `, [limit]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                sample_size: result.rows.length,
                rows: result.rows
              }, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP DB Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
