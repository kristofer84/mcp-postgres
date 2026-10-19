import * as read from "./read.mjs";
import * as write from "./write.mjs";
import { READ_ONLY_MODE } from "../config.mjs";

// Read-only mode: set DB_READ_ONLY=true to disable all write and DDL tools
export { READ_ONLY_MODE };
if (READ_ONLY_MODE) {
  console.error('Read-only mode enabled: write and DDL tools are disabled, and the database session is read-only');
}

export const WRITE_TOOLS = new Set([
  'update_data', 'delete_data', 'insert_data',
  'execute_raw_query', 'create_table', 'alter_table'
]);

export const TOOL_DEFINITIONS = [
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
          description: "Object with column names as keys and new values (alias: 'data')"
        },
        data: {
          type: "object",
          description: "Alias for 'values' — object with column names as keys and new values"
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
];

export const TOOL_HANDLERS = {
  get_schema: read.getSchema,
  query_data: read.queryData,
  list_tables: read.listTables,
  describe_table: read.describeTable,
  get_table_sample: read.getTableSample,
  check_certificate_cache: read.checkCertificateCache,
  count_rows: read.countRows,
  table_exists: read.tableExists,
  column_exists: read.columnExists,
  get_relationships: read.getRelationships,
  get_connection_status: read.getConnectionStatus,
  update_data: write.updateData,
  delete_data: write.deleteData,
  insert_data: write.insertData,
  execute_raw_query: write.executeRawQuery,
  create_table: write.createTable,
  alter_table: write.alterTable,
};

// Write tools are hidden from the tool list in read-only mode
export function listTools() {
  return TOOL_DEFINITIONS.filter(tool => !READ_ONLY_MODE || !WRITE_TOOLS.has(tool.name));
}

export function isToolBlocked(name) {
  return READ_ONLY_MODE && WRITE_TOOLS.has(name);
}

export async function callTool(name, args, db) {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return handler(args, db);
}
