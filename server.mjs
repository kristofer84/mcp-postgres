#!/usr/bin/env node

import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "pg";

// AWS RDS Certificate Management
const AWS_RDS_CERT_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const CERT_CACHE_DIR = path.join(os.homedir(), ".aws", "rds-certs");
const CERT_FILE_PATH = path.join(CERT_CACHE_DIR, "rds-global-bundle.pem");

async function downloadRdsCertificate() {
  return new Promise((resolve, reject) => {
    console.error("Downloading AWS RDS certificate bundle...");

    const file = fs.createWriteStream(CERT_FILE_PATH);
    const request = https.get(AWS_RDS_CERT_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download certificate: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.error("AWS RDS certificate bundle downloaded successfully");
        resolve(CERT_FILE_PATH);
      });
    });

    request.on('error', (err) => {
      fs.unlink(CERT_FILE_PATH, () => { }); // Delete partial file
      reject(err);
    });

    file.on('error', (err) => {
      fs.unlink(CERT_FILE_PATH, () => { }); // Delete partial file
      reject(err);
    });
  });
}

async function ensureRdsCertificate() {
  try {
    // Return cached certificate if available
    if (certificateCache) {
      return certificateCache;
    }

    // Create cache directory if it doesn't exist
    if (!fs.existsSync(CERT_CACHE_DIR)) {
      fs.mkdirSync(CERT_CACHE_DIR, { recursive: true });
    }

    // Check if certificate already exists and is recent (less than 30 days old)
    if (fs.existsSync(CERT_FILE_PATH)) {
      const stats = fs.statSync(CERT_FILE_PATH);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      const daysRemaining = Math.ceil(30 - ageInDays);

      if (ageInDays < 30) {
        // Verify the cached certificate is valid (not corrupted)
        try {
          const certContent = fs.readFileSync(CERT_FILE_PATH, 'utf8');
          if (certContent.includes('-----BEGIN CERTIFICATE-----') && certContent.includes('-----END CERTIFICATE-----')) {
            console.error(`Using cached AWS RDS certificate bundle (expires in ${daysRemaining} days)`);
            certificateCache = CERT_FILE_PATH;
            return CERT_FILE_PATH;
          } else {
            console.error("Cached certificate appears corrupted, re-downloading...");
          }
        } catch (readError) {
          console.error("Failed to read cached certificate, re-downloading...");
        }
      } else {
        console.error(`AWS RDS certificate bundle expired ${Math.ceil(ageInDays - 30)} days ago, re-downloading...`);
      }
    } else {
      console.error("No cached AWS RDS certificate found, downloading...");
    }

    // Download the certificate
    const certPath = await downloadRdsCertificate();
    certificateCache = certPath;
    return certPath;
  } catch (error) {
    console.error("Failed to ensure RDS certificate:", error.message);
    // Return null to fall back to less secure SSL mode
    return null;
  }
}

function isAwsRdsEndpoint(hostname) {
  return hostname && hostname.includes('.rds.amazonaws.com');
}

// Cache for certificate to avoid multiple downloads
let certificateCache = null;

// Build SSL configuration for a given sslMode and hostname
async function buildSslConfig(sslMode, hostname) {
  if (sslMode === 'require') return { rejectUnauthorized: true };
  if (sslMode === 'disable') return false;
  if (sslMode) return true;

  if (isAwsRdsEndpoint(hostname)) {
    try {
      const certPath = await ensureRdsCertificate();
      if (certPath && fs.existsSync(certPath)) {
        console.error(`Auto-configured SSL for AWS RDS endpoint: ${hostname}`);
        return { rejectUnauthorized: true, ca: fs.readFileSync(certPath, 'utf8') };
      }
      console.error(`WARNING: Could not obtain RDS certificate, falling back to unverified SSL for: ${hostname}`);
      return { rejectUnauthorized: false };
    } catch (error) {
      console.error(`WARNING: SSL auto-configuration failed, falling back to unverified SSL: ${error.message}`);
      return { rejectUnauthorized: false };
    }
  }

  return undefined; // No SSL configured
}

function getCacheStatus() {
  if (!fs.existsSync(CERT_FILE_PATH)) {
    return { exists: false, message: "No certificate cached" };
  }

  const stats = fs.statSync(CERT_FILE_PATH);
  const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
  const daysRemaining = Math.ceil(30 - ageInDays);

  return {
    exists: true,
    ageInDays: Math.ceil(ageInDays),
    daysRemaining: daysRemaining,
    expired: ageInDays >= 30,
    path: CERT_FILE_PATH,
    size: stats.size,
    lastModified: stats.mtime.toISOString(),
    message: ageInDays < 30
      ? `Certificate cached (expires in ${daysRemaining} days)`
      : `Certificate expired ${Math.ceil(ageInDays - 30)} days ago`
  };
}

// Read-only mode: set DB_READ_ONLY=true to disable all write and DDL tools
const READ_ONLY_MODE = process.env.DB_READ_ONLY === 'true' || process.env.DB_READ_ONLY === '1';
if (READ_ONLY_MODE) {
  console.error('Read-only mode enabled: write and DDL tools are disabled');
}

const WRITE_TOOLS = new Set([
  'update_data', 'delete_data', 'insert_data',
  'execute_raw_query', 'create_table', 'alter_table'
]);

// Load configuration from multiple sources
async function loadConfig() {
  // Try individual environment variables first (preferred method)
  if (process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.DB_USER || process.env.POSTGRES_USER) {
    const config = {
      db: {
        host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT) || 5432,
        user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
        password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || '',
        database: process.env.DB_NAME || process.env.POSTGRES_DB || 'postgres'
      }
    };

    // Add SSL configuration with AWS RDS auto-detection
    const sslMode = process.env.DB_SSL_MODE || process.env.POSTGRES_SSL_MODE;
    const ssl = await buildSslConfig(sslMode, config.db.host);
    if (ssl !== undefined) config.db.ssl = ssl;

    return config;
  }

  // Fallback to DATABASE_URL if individual env vars not set
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    const config = {
      db: {
        host: url.hostname,
        port: parseInt(url.port) || 5432,
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1)
      }
    };

    // Check for SSL mode in URL search params or environment
    const sslMode = url.searchParams.get('sslmode') || process.env.DB_SSL_MODE || process.env.POSTGRES_SSL_MODE;
    const ssl = await buildSslConfig(sslMode, config.db.host);
    if (ssl !== undefined) config.db.ssl = ssl;

    return config;
  }

  // Try config file in current directory
  const configPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    // Process SSL mode if specified in config
    if (config.db) {
      const sslMode = config.db.sslmode;
      if (sslMode) delete config.db.sslmode;
      const ssl = await buildSslConfig(sslMode || null, config.db.host);
      if (ssl !== undefined) config.db.ssl = ssl;
    }

    return config;
  }

  // Default configuration
  return {
    db: {
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'postgres',
      database: 'postgres',
      ssl: false // Default to no SSL for local development
    }
  };
}

// Database connection management
let db = null;
let dbConfig = null;

// Initialize application
async function initializeApp() {
  const config = await loadConfig();
  dbConfig = config;

  // Close existing connection if any
  if (db) {
    try {
      await db.end();
    } catch (err) {
      console.error('Error closing existing connection:', err.message);
    }
  }

  // Initialize database connection with retry logic
  db = new Client(config.db);

  // Add error handler to prevent unhandled errors
  db.on('error', (err) => {
    console.error('Database connection error:', err.message);
  });

  let retries = 3;
  while (retries > 0) {
    try {
      await db.connect();
      // Apply a default 30-second statement timeout to prevent runaway queries
      const timeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000;
      await db.query(`SET statement_timeout = ${timeoutMs}`);
      console.error(`Connected to database: ${config.db.host}:${config.db.port}/${config.db.database}`);
      break;
    } catch (error) {
      retries--;
      console.error(`Connection attempt failed: ${error.message}`);

      if (retries === 0) {
        throw new Error(`Failed to connect to database after 3 attempts: ${error.message}`);
      }

      // Wait 2 seconds before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return db;
}

await initializeApp();

// Ensure database connection is alive
async function ensureConnection() {
  if (!db || db._ending || db._ended) {
    console.error('Database connection lost, reconnecting...');
    await initializeApp();
  }
}

// Helper function to normalize SQL queries by removing comments and whitespace
// This allows queries with comments to pass validation checks
function normalizeQuery(query) {
  return query
    .replace(/--[^\n]*/g, '') // Remove single-line comments (-- comment)
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments (/* comment */)
    .trim()
    .toLowerCase();
}

// Quote a PostgreSQL identifier (table/column name) to prevent SQL injection
function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Validate a PostgreSQL column/data type (e.g. VARCHAR(100), INTEGER, DECIMAL(10,2))
function sanitizeType(type) {
  if (!/^[a-zA-Z0-9\s(),._[\]]+$/.test(type)) {
    throw new Error(`Invalid column type: ${type}`);
  }
  return type;
}

// Validate a column default value — block statement terminators and comment sequences
function sanitizeDefault(val) {
  if (/;|--|\/\*|\*\//.test(val)) {
    throw new Error(`Invalid default value: ${val}`);
  }
  return val;
}

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
        name: "query_data",
        description: "Query data from the database (SELECT only for safety)",
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
      },
      {
        name: "check_certificate_cache",
        description: "Check the status of the AWS RDS certificate cache",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "update_data",
        description: "Update rows in a table with specified values and conditions",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to update"
            },
            values: {
              type: "object",
              description: "Object with column names as keys and new values"
            },
            where: {
              type: "object",
              description: "Object with column names as keys and values to match for WHERE clause"
            },
            dry_run: {
              type: "boolean",
              description: "If true, only preview what would be updated without executing",
              default: false
            },
            limit: {
              type: "number",
              description: "Maximum number of rows to update (safety limit)",
              default: 1000
            }
          },
          required: ["table_name", "values", "where"]
        }
      },
      {
        name: "delete_data",
        description: "Delete rows from a table based on specified conditions",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to delete from"
            },
            where: {
              type: "object",
              description: "Object with column names as keys and values to match for WHERE clause"
            },
            dry_run: {
              type: "boolean",
              description: "If true, only preview what would be deleted without executing",
              default: false
            },
            limit: {
              type: "number",
              description: "Maximum number of rows to delete (safety limit)",
              default: 1000
            }
          },
          required: ["table_name", "where"]
        }
      },
      {
        name: "insert_data",
        description: "Insert new rows into a table",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to insert into"
            },
            data: {
              type: "object",
              description: "Object with column names as keys and values to insert"
            }
          },
          required: ["table_name", "data"]
        }
      },
      {
        name: "execute_raw_query",
        description: "Execute any SQL query including INSERT, UPDATE, DELETE (use with caution)",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "SQL query to execute"
            },
            params: {
              type: "array",
              description: "Optional array of parameters for parameterized queries",
              items: {}
            }
          },
          required: ["query"]
        }
      },
      {
        name: "count_rows",
        description: "Count rows in a table with optional WHERE conditions",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to count rows from"
            },
            where: {
              type: "object",
              description: "Optional: Object with column names as keys and values to match for WHERE clause"
            }
          },
          required: ["table_name"]
        }
      },
      {
        name: "table_exists",
        description: "Check if a table exists in the database",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to check"
            }
          },
          required: ["table_name"]
        }
      },
      {
        name: "column_exists",
        description: "Check if a column exists in a table",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table"
            },
            column_name: {
              type: "string",
              description: "Name of the column to check"
            }
          },
          required: ["table_name", "column_name"]
        }
      },
      {
        name: "get_relationships",
        description: "Get foreign key relationships for tables",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Optional: specific table name to get relationships for"
            }
          }
        }
      },
      {
        name: "create_table",
        description: "Create a new table with specified columns",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to create"
            },
            columns: {
              type: "array",
              description: "Array of column definitions",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string" },
                  nullable: { type: "boolean", default: true },
                  primary_key: { type: "boolean", default: false },
                  unique: { type: "boolean", default: false },
                  default: { type: "string" }
                },
                required: ["name", "type"]
              }
            }
          },
          required: ["table_name", "columns"]
        }
      },
      {
        name: "alter_table",
        description: "Modify an existing table structure",
        inputSchema: {
          type: "object",
          properties: {
            table_name: {
              type: "string",
              description: "Name of the table to alter"
            },
            action: {
              type: "string",
              enum: ["add_column", "drop_column", "rename_column", "alter_column_type"],
              description: "Type of alteration to perform"
            },
            column_name: {
              type: "string",
              description: "Name of the column (for add/drop/rename/alter)"
            },
            column_type: {
              type: "string",
              description: "Data type (for add_column or alter_column_type)"
            },
            new_column_name: {
              type: "string",
              description: "New column name (for rename_column)"
            },
            nullable: {
              type: "boolean",
              description: "Whether column is nullable (for add_column)"
            },
            default_value: {
              type: "string",
              description: "Default value (for add_column)"
            }
          },
          required: ["table_name", "action", "column_name"]
        }
      },
      {
        name: "get_connection_status",
        description: "Get database connection status and performance metrics",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ].filter(tool => !READ_ONLY_MODE || !WRITE_TOOLS.has(tool.name)),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (READ_ONLY_MODE && WRITE_TOOLS.has(name)) {
      throw new Error(`Tool '${name}' is disabled: server is running in read-only mode (DB_READ_ONLY=true)`);
    }

    // Ensure connection is alive before executing any query
    await ensureConnection();

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

      case "query_data": {
        const query = args?.query;
        if (!query) {
          throw new Error("Query is required");
        }

        // Safety check - only allow SELECT statements
        // Normalize query to handle comments and whitespace
        const normalizedQuery = normalizeQuery(query);
        if (!normalizedQuery.startsWith("select")) {
          throw new Error("Only SELECT queries are allowed for safety");
        }

        const startTime = Date.now();
        const result = await db.query(query);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rows: result.rows,
                rowCount: result.rowCount,
                execution_time_ms: executionTime
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
        const columns = await db.query(`
            SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
          `, [tableName]);
        const indexes = await db.query(`
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = $1
          `, [tableName]);
        const constraints = await db.query(`
            SELECT constraint_name, constraint_type
            FROM information_schema.table_constraints
            WHERE table_schema = 'public' AND table_name = $1
          `, [tableName]);

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

      case "check_certificate_cache": {
        const cacheStatus = getCacheStatus();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                aws_rds_certificate_cache: cacheStatus,
                cache_directory: CERT_CACHE_DIR,
                auto_download_url: AWS_RDS_CERT_URL
              }, null, 2)
            }
          ]
        };
      }

      case "update_data": {
        const tableName = args?.table_name;
        const values = args?.values;
        const where = args?.where;

        if (!tableName || !values || !where) {
          throw new Error("table_name, values, and where are required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const limitVal = Math.min(args?.limit ?? 1000, 10000);

        // Build SET clause with quoted column names
        const setColumns = Object.keys(values);
        const setClause = setColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`).join(', ');

        // Build WHERE clause with quoted column names
        const whereColumns = Object.keys(where);
        const whereClause = whereColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + setColumns.length + 1}`).join(' AND ');

        const queryParams = [...Object.values(values), ...Object.values(where)];

        // dry_run: preview affected rows without modifying data
        if (args?.dry_run) {
          const whereClauseForSelect = whereColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`).join(' AND ');
          const previewResult = await db.query(
            `SELECT * FROM ${sanitizedTable} WHERE ${whereClauseForSelect} LIMIT $${whereColumns.length + 1}`,
            [...Object.values(where), limitVal]
          );
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                dry_run: true,
                would_update_rows: previewResult.rowCount,
                preview_rows: previewResult.rows,
                pending_values: values
              }, null, 2)
            }]
          };
        }

        // Enforce row limit via ctid subquery
        const limitParamIdx = queryParams.length + 1;
        queryParams.push(limitVal);

        const startTime = Date.now();
        const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ctid IN (SELECT ctid FROM ${sanitizedTable} WHERE ${whereClause} LIMIT $${limitParamIdx}) RETURNING *`;
        const result = await db.query(query, queryParams);
        const executionTime = Date.now() - startTime;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              updated_rows: result.rowCount,
              returning: result.rows,
              execution_time_ms: executionTime
            }, null, 2)
          }]
        };
      }

      case "delete_data": {
        const tableName = args?.table_name;
        const where = args?.where;

        if (!tableName || !where) {
          throw new Error("table_name and where are required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const limitVal = Math.min(args?.limit ?? 1000, 10000);

        // Build WHERE clause with quoted column names
        const whereColumns = Object.keys(where);
        const whereClause = whereColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`).join(' AND ');
        const queryParams = [...Object.values(where)];

        // dry_run: preview affected rows without deleting
        if (args?.dry_run) {
          const previewResult = await db.query(
            `SELECT * FROM ${sanitizedTable} WHERE ${whereClause} LIMIT $${queryParams.length + 1}`,
            [...queryParams, limitVal]
          );
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                dry_run: true,
                would_delete_rows: previewResult.rowCount,
                preview_rows: previewResult.rows
              }, null, 2)
            }]
          };
        }

        // Enforce row limit via ctid subquery
        const limitParamIdx = queryParams.length + 1;
        queryParams.push(limitVal);

        const startTime = Date.now();
        const query = `DELETE FROM ${sanitizedTable} WHERE ctid IN (SELECT ctid FROM ${sanitizedTable} WHERE ${whereClause} LIMIT $${limitParamIdx}) RETURNING *`;
        const result = await db.query(query, queryParams);
        const executionTime = Date.now() - startTime;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              deleted_rows: result.rowCount,
              returning: result.rows,
              execution_time_ms: executionTime
            }, null, 2)
          }]
        };
      }

      case "insert_data": {
        const tableName = args?.table_name;
        const data = args?.data;

        if (!tableName || !data) {
          throw new Error("table_name and data are required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

        const startTime = Date.now();
        const query = `INSERT INTO ${sanitizedTable} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const result = await db.query(query, values);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                inserted_rows: result.rowCount,
                returning: result.rows,
                execution_time_ms: executionTime
              }, null, 2)
            }
          ]
        };
      }

      case "execute_raw_query": {
        const query = args?.query;
        const params = args?.params || [];

        if (!query) {
          throw new Error("Query is required");
        }

        const startTime = Date.now();
        const result = await db.query(query, params);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rows: result.rows,
                rowCount: result.rowCount,
                command: result.command,
                execution_time_ms: executionTime
              }, null, 2)
            }
          ]
        };
      }

      case "count_rows": {
        const tableName = args?.table_name;
        const where = args?.where;

        if (!tableName) {
          throw new Error("table_name is required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        let query = `SELECT COUNT(*) as count FROM ${sanitizedTable}`;
        let queryParams = [];

        if (where && Object.keys(where).length > 0) {
          const whereColumns = Object.keys(where);
          const whereClause = whereColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`).join(' AND ');
          query += ` WHERE ${whereClause}`;
          queryParams = Object.values(where);
        }

        const startTime = Date.now();
        const result = await db.query(query, queryParams);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                count: parseInt(result.rows[0].count),
                execution_time_ms: executionTime
              }, null, 2)
            }
          ]
        };
      }

      case "table_exists": {
        const tableName = args?.table_name;

        if (!tableName) {
          throw new Error("table_name is required");
        }

        const result = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [tableName]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                exists: result.rows[0].exists
              }, null, 2)
            }
          ]
        };
      }

      case "column_exists": {
        const tableName = args?.table_name;
        const columnName = args?.column_name;

        if (!tableName || !columnName) {
          throw new Error("table_name and column_name are required");
        }

        const result = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = $1 
            AND column_name = $2
          )
        `, [tableName, columnName]);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                column_name: columnName,
                exists: result.rows[0].exists
              }, null, 2)
            }
          ]
        };
      }

      case "get_relationships": {
        const tableName = args?.table_name;
        let query = `
          SELECT
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            tc.constraint_name
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = 'public'
        `;

        let queryParams = [];
        if (tableName) {
          query += ` AND tc.table_name = $1`;
          queryParams = [tableName];
        }

        query += ` ORDER BY tc.table_name, kcu.column_name`;

        const result = await db.query(query, queryParams);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                relationships: result.rows,
                count: result.rowCount
              }, null, 2)
            }
          ]
        };
      }

      case "create_table": {
        const tableName = args?.table_name;
        const columns = args?.columns;

        if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
          throw new Error("table_name and columns array are required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        
        const columnDefs = columns.map(col => {
          let def = `${quoteIdent(col.name)} ${sanitizeType(col.type)}`;
          if (col.primary_key) def += ' PRIMARY KEY';
          if (col.unique && !col.primary_key) def += ' UNIQUE';
          if (col.nullable === false && !col.primary_key) def += ' NOT NULL';
          if (col.default !== undefined) def += ` DEFAULT ${sanitizeDefault(col.default)}`;
          return def;
        }).join(', ');

        const query = `CREATE TABLE ${sanitizedTable} (${columnDefs})`;
        const startTime = Date.now();
        await db.query(query);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                created: true,
                execution_time_ms: executionTime,
                query: query
              }, null, 2)
            }
          ]
        };
      }

      case "alter_table": {
        const tableName = args?.table_name;
        const action = args?.action;
        const columnName = args?.column_name;

        if (!tableName || !action || !columnName) {
          throw new Error("table_name, action, and column_name are required");
        }

        const sanitizedTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        let query;

        switch (action) {
          case "add_column":
            if (!args.column_type) {
              throw new Error("column_type is required for add_column");
            }
            query = `ALTER TABLE ${sanitizedTable} ADD COLUMN ${quoteIdent(columnName)} ${sanitizeType(args.column_type)}`;
            if (args.nullable === false) query += ' NOT NULL';
            if (args.default_value !== undefined) query += ` DEFAULT ${sanitizeDefault(args.default_value)}`;
            break;

          case "drop_column":
            query = `ALTER TABLE ${sanitizedTable} DROP COLUMN ${quoteIdent(columnName)}`;
            break;

          case "rename_column":
            if (!args.new_column_name) {
              throw new Error("new_column_name is required for rename_column");
            }
            query = `ALTER TABLE ${sanitizedTable} RENAME COLUMN ${quoteIdent(columnName)} TO ${quoteIdent(args.new_column_name)}`;
            break;

          case "alter_column_type":
            if (!args.column_type) {
              throw new Error("column_type is required for alter_column_type");
            }
            query = `ALTER TABLE ${sanitizedTable} ALTER COLUMN ${quoteIdent(columnName)} TYPE ${sanitizeType(args.column_type)}`;
            break;

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        const startTime = Date.now();
        await db.query(query);
        const executionTime = Date.now() - startTime;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                table_name: tableName,
                action: action,
                success: true,
                execution_time_ms: executionTime,
                query: query
              }, null, 2)
            }
          ]
        };
      }

      case "get_connection_status": {
        const connectionInfo = {
          connected: !db._ending && !db._ended,
          host: dbConfig?.db?.host,
          port: dbConfig?.db?.port,
          database: dbConfig?.db?.database,
          user: dbConfig?.db?.user,
          ssl_enabled: !!dbConfig?.db?.ssl
        };

        try {
          const dbSize = await db.query(`SELECT pg_database_size(current_database()) as size`);
          const connections = await db.query(`SELECT count(*) as count FROM pg_stat_activity WHERE datname = current_database()`);
          const version = await db.query(`SELECT version()`);

          connectionInfo.database_size_bytes = parseInt(dbSize.rows[0].size);
          connectionInfo.database_size_mb = Math.round(dbSize.rows[0].size / 1024 / 1024 * 100) / 100;
          connectionInfo.active_connections = parseInt(connections.rows[0].count);
          connectionInfo.postgres_version = version.rows[0].version;
        } catch (error) {
          connectionInfo.stats_error = error.message;
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(connectionInfo, null, 2)
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
