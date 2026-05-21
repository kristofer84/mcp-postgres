#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TEST_DB = "test";

// Color output helpers
const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
};

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  try {
    console.log(colors.cyan(`\n🧪 Testing: ${name}`));
    await testFn();
    testsPassed++;
    console.log(colors.green(`✓ PASSED: ${name}`));
  } catch (error) {
    testsFailed++;
    console.log(colors.red(`✗ FAILED: ${name}`));
    console.log(colors.red(`  Error: ${error.message}`));
  }
}

async function callTool(client, toolName, args = {}) {
  const result = await client.callTool({ name: toolName, arguments: args });
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  if (result.isError) throw new Error(`Tool returned error: ${content.text}`);
  return JSON.parse(content.text);
}

// Returns { isError, text } without JSON-parsing or throwing on server errors
async function callToolRaw(client, toolName, args = {}) {
  const result = await client.callTool({ name: toolName, arguments: args });
  const content = result.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  return { isError: !!result.isError, text: content.text };
}

// Asserts the tool returns an error response and returns the error message text
async function callToolExpectError(client, toolName, args = {}) {
  const { isError, text } = await callToolRaw(client, toolName, args);
  if (!isError) throw new Error(`Expected an error response but got success: ${text}`);
  return text;
}

async function listToolNames(client) {
  const result = await client.listTools();
  return result.tools.map((t) => t.name);
}

function createServerTransport(envOverrides = {}) {
  return new StdioClientTransport({
    command: "node",
    args: ["server.mjs"],
    env: {
      ...process.env,
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_USER: "postgres",
      DB_PASSWORD: "postgres",
      DB_NAME: TEST_DB,
      ...envOverrides,
    },
  });
}

async function main() {
  console.log(colors.blue("=".repeat(60)));
  console.log(colors.blue("MCP Database Server - Tool Test Suite"));
  console.log(colors.blue("=".repeat(60)));

  // Start the MCP server
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(createServerTransport());
  console.log(colors.green("✓ Connected to MCP server\n"));

  // Test 1: get_connection_status
  await runTest("get_connection_status", async () => {
    const result = await callTool(client, "get_connection_status");
    if (!result.connected) throw new Error("Not connected to database");
    if (result.database !== TEST_DB) throw new Error("Wrong database");
    console.log(`  Database: ${result.database}, Version: ${result.postgres_version?.split(" ")[0]}`);
  });

  // Test 2: create_table
  await runTest("create_table", async () => {
    const result = await callTool(client, "create_table", {
      table_name: "test_users",
      columns: [
        { name: "id", type: "SERIAL", primary_key: true },
        { name: "name", type: "VARCHAR(100)", nullable: false },
        { name: "email", type: "VARCHAR(255)", unique: true },
        { name: "age", type: "INTEGER" },
        { name: "created_at", type: "TIMESTAMP", default: "CURRENT_TIMESTAMP" },
      ],
    });
    if (!result.created) throw new Error("Table not created");
    console.log(`  Created table: ${result.table_name}`);
  });

  // Test 3: table_exists
  await runTest("table_exists", async () => {
    const result = await callTool(client, "table_exists", { table_name: "test_users" });
    if (!result.exists) throw new Error("Table should exist");
    console.log(`  Table exists: ${result.table_name}`);
  });

  // Test 4: column_exists
  await runTest("column_exists", async () => {
    const result = await callTool(client, "column_exists", {
      table_name: "test_users",
      column_name: "email",
    });
    if (!result.exists) throw new Error("Column should exist");
    console.log(`  Column exists: ${result.column_name} in ${result.table_name}`);
  });

  // Test 5: list_tables
  await runTest("list_tables", async () => {
    const result = await callTool(client, "list_tables");
    const hasTestUsers = result.some((t) => t.table_name === "test_users");
    if (!hasTestUsers) throw new Error("test_users not in table list");
    console.log(`  Found ${result.length} tables`);
  });

  // Test 6: describe_table
  await runTest("describe_table", async () => {
    const result = await callTool(client, "describe_table", { table_name: "test_users" });
    if (result.columns.length === 0) throw new Error("No columns found");
    console.log(`  Table has ${result.columns.length} columns, ${result.indexes.length} indexes`);
  });

  // Test 7: get_schema
  await runTest("get_schema", async () => {
    const result = await callTool(client, "get_schema", { table_name: "test_users" });
    if (result.length === 0) throw new Error("No schema info");
    console.log(`  Schema has ${result.length} column definitions`);
  });

  // Test 8: insert_data
  await runTest("insert_data", async () => {
    const result = await callTool(client, "insert_data", {
      table_name: "test_users",
      data: { name: "Alice", email: "alice@example.com", age: 30 },
    });
    if (result.inserted_rows !== 1) throw new Error("Insert failed");
    console.log(`  Inserted ${result.inserted_rows} row in ${result.execution_time_ms}ms`);
  });

  // Insert more test data
  await callTool(client, "insert_data", {
    table_name: "test_users",
    data: { name: "Bob", email: "bob@example.com", age: 25 },
  });
  await callTool(client, "insert_data", {
    table_name: "test_users",
    data: { name: "Charlie", email: "charlie@example.com", age: 35 },
  });

  // Test 9: count_rows
  await runTest("count_rows", async () => {
    const result = await callTool(client, "count_rows", { table_name: "test_users" });
    if (result.count !== 3) throw new Error(`Expected 3 rows, got ${result.count}`);
    console.log(`  Count: ${result.count} rows in ${result.execution_time_ms}ms`);
  });

  // Test 10: count_rows with WHERE
  await runTest("count_rows with WHERE", async () => {
    const result = await callTool(client, "count_rows", {
      table_name: "test_users",
      where: { name: "Alice" },
    });
    if (result.count !== 1) throw new Error(`Expected 1 row, got ${result.count}`);
    console.log(`  Count with WHERE: ${result.count} rows`);
  });

  // Test 11: query_data
  await runTest("query_data", async () => {
    const result = await callTool(client, "query_data", {
      query: "SELECT * FROM test_users WHERE age > 25 ORDER BY age",
    });
    if (result.rowCount !== 2) throw new Error("Query returned wrong count");
    console.log(`  Query returned ${result.rowCount} rows in ${result.execution_time_ms}ms`);
  });

  // Test 12: get_table_sample
  await runTest("get_table_sample", async () => {
    const result = await callTool(client, "get_table_sample", {
      table_name: "test_users",
      limit: 2,
    });
    if (result.sample_size !== 2) throw new Error("Wrong sample size");
    console.log(`  Sample: ${result.sample_size} rows from ${result.table_name}`);
  });

  // Test 13: update_data with dry_run
  await runTest("update_data (dry_run)", async () => {
    const result = await callTool(client, "update_data", {
      table_name: "test_users",
      values: { age: 99 },
      where: { name: "Alice" },
      dry_run: true,
    });
    if (!result.dry_run) throw new Error("dry_run flag not set in response");
    if (result.would_update_rows !== 1) throw new Error(`Expected 1 preview row, got ${result.would_update_rows}`);
    // Verify no actual update happened
    const check = await callTool(client, "count_rows", { table_name: "test_users", where: { name: "Alice" } });
    if (check.count !== 1) throw new Error("Row should still exist after dry_run");
    console.log(`  dry_run preview: ${result.would_update_rows} rows would be updated`);
  });

  // Test 14: update_data
  await runTest("update_data", async () => {
    const result = await callTool(client, "update_data", {
      table_name: "test_users",
      values: { age: 31 },
      where: { name: "Alice" },
    });
    if (result.updated_rows !== 1) throw new Error("Update failed");
    console.log(`  Updated ${result.updated_rows} rows in ${result.execution_time_ms}ms`);
  });

  // Test 15: alter_table (add_column)
  await runTest("alter_table (add_column)", async () => {
    const result = await callTool(client, "alter_table", {
      table_name: "test_users",
      action: "add_column",
      column_name: "status",
      column_type: "VARCHAR(20)",
      default_value: "'active'",
    });
    if (!result.success) throw new Error("Alter table failed");
    console.log(`  Added column: status`);
  });

  // Test 16: execute_raw_query
  await runTest("execute_raw_query", async () => {
    const result = await callTool(client, "execute_raw_query", {
      query: "UPDATE test_users SET status = $1 WHERE name = $2",
      params: ["premium", "Bob"],
    });
    if (result.rowCount !== 1) throw new Error("Raw query failed");
    console.log(`  Raw query: ${result.command}, affected ${result.rowCount} rows`);
  });

  // Create a second table for relationship testing
  await callTool(client, "create_table", {
    table_name: "test_orders",
    columns: [
      { name: "id", type: "SERIAL", primary_key: true },
      { name: "user_id", type: "INTEGER" },
      { name: "amount", type: "DECIMAL(10,2)" },
    ],
  });

  await callTool(client, "execute_raw_query", {
    query: "ALTER TABLE test_orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES test_users(id)",
  });

  // Test 17: get_relationships
  await runTest("get_relationships", async () => {
    const result = await callTool(client, "get_relationships");
    if (result.count === 0) throw new Error("No relationships found");
    console.log(`  Found ${result.count} foreign key relationships`);
  });

  // Test 18: delete_data with dry_run
  await runTest("delete_data (dry_run)", async () => {
    const result = await callTool(client, "delete_data", {
      table_name: "test_users",
      where: { name: "Charlie" },
      dry_run: true,
    });
    if (!result.dry_run) throw new Error("dry_run flag not set in response");
    if (result.would_delete_rows !== 1) throw new Error(`Expected 1 preview row, got ${result.would_delete_rows}`);
    // Verify no actual delete happened
    const check = await callTool(client, "count_rows", { table_name: "test_users", where: { name: "Charlie" } });
    if (check.count !== 1) throw new Error("Row should still exist after dry_run");
    console.log(`  dry_run preview: ${result.would_delete_rows} rows would be deleted`);
  });

  // Test 19: delete_data
  await runTest("delete_data", async () => {
    // First verify the row exists
    const countBefore = await callTool(client, "count_rows", {
      table_name: "test_users",
      where: { name: "Bob" },
    });
    if (countBefore.count === 0) throw new Error("Test data not found");
    
    const result = await callTool(client, "delete_data", {
      table_name: "test_users",
      where: { name: "Bob" },
    });
    if (result.deleted_rows !== 1) throw new Error("Delete failed");
    console.log(`  Deleted ${result.deleted_rows} rows`);
  });

  // Test 20: check_certificate_cache
  await runTest("check_certificate_cache", async () => {
    const result = await callTool(client, "check_certificate_cache");
    console.log(`  Certificate cache: ${result.aws_rds_certificate_cache.message}`);
  });

  // Test 21: query_data rejects multi-statement queries
  await runTest("query_data rejects multi-statement queries", async () => {
    const errText = await callToolExpectError(client, "query_data", {
      query: "SELECT 1; DROP TABLE test_users",
    });
    if (!errText.toLowerCase().includes("multi-statement")) {
      throw new Error(`Unexpected error message: ${errText}`);
    }
    console.log(`  Correctly rejected: ${errText}`);
  });

  // Test 22: query_data rejects non-SELECT
  await runTest("query_data rejects non-SELECT", async () => {
    const errText = await callToolExpectError(client, "query_data", {
      query: "DELETE FROM test_users WHERE 1=1",
    });
    if (!errText.toLowerCase().includes("select")) {
      throw new Error(`Unexpected error message: ${errText}`);
    }
    console.log(`  Correctly rejected: ${errText}`);
  });

  // Test 23: quoteIdent handles table names with special characters
  // A hyphenated name would have been silently mangled to "testhyphen" by the
  // old regex-stripping approach; quoteIdent wraps it as "test-hyphen" instead.
  await runTest("quoteIdent: table name with hyphen works across all DML tools", async () => {
    await callTool(client, "create_table", {
      table_name: "test-hyphen",
      columns: [
        { name: "id", type: "SERIAL", primary_key: true },
        { name: "value", type: "TEXT" },
      ],
    });

    const inserted = await callTool(client, "insert_data", {
      table_name: "test-hyphen",
      data: { value: "hello" },
    });
    if (inserted.inserted_rows !== 1) throw new Error("Insert failed");

    const sampled = await callTool(client, "get_table_sample", {
      table_name: "test-hyphen",
      limit: 5,
    });
    if (sampled.sample_size !== 1) throw new Error("Sample failed");

    const counted = await callTool(client, "count_rows", { table_name: "test-hyphen" });
    if (counted.count !== 1) throw new Error("Count failed");

    const updated = await callTool(client, "update_data", {
      table_name: "test-hyphen",
      values: { value: "world" },
      where: { value: "hello" },
    });
    if (updated.updated_rows !== 1) throw new Error("Update failed");

    const deleted = await callTool(client, "delete_data", {
      table_name: "test-hyphen",
      where: { value: "world" },
    });
    if (deleted.deleted_rows !== 1) throw new Error("Delete failed");

    await callTool(client, "execute_raw_query", { query: 'DROP TABLE "test-hyphen"' });
    console.log(`  All DML operations succeeded on hyphenated table name`);
  });

  // Cleanup
  console.log(colors.yellow("\n🧹 Cleaning up test data..."));
  await callTool(client, "execute_raw_query", {
    query: "DROP TABLE IF EXISTS test_orders CASCADE",
  });
  await callTool(client, "execute_raw_query", {
    query: "DROP TABLE IF EXISTS test_users CASCADE",
  });
  console.log(colors.green("✓ Cleanup complete"));

  // Read-only mode tests (separate server instance)
  console.log(colors.blue("\n" + "=".repeat(60)));
  console.log(colors.blue("Read-Only Mode Tests (DB_READ_ONLY=true)"));
  console.log(colors.blue("=".repeat(60)));

  const WRITE_TOOLS = [
    "update_data", "delete_data", "insert_data",
    "execute_raw_query", "create_table", "alter_table",
  ];
  const READ_TOOLS = [
    "list_tables", "get_schema", "query_data", "describe_table",
    "get_table_sample", "check_certificate_cache", "count_rows",
    "table_exists", "column_exists", "get_relationships", "get_connection_status",
  ];

  const roClient = new Client(
    { name: "test-client-readonly", version: "1.0.0" },
    { capabilities: {} }
  );
  await roClient.connect(createServerTransport({ DB_READ_ONLY: "true" }));
  console.log(colors.green("✓ Connected to read-only MCP server\n"));

  // Test 24: write tools absent from tool list
  await runTest("read-only mode: write tools absent from tool list", async () => {
    const toolNames = await listToolNames(roClient);
    const present = WRITE_TOOLS.filter((t) => toolNames.includes(t));
    if (present.length > 0) {
      throw new Error(`Write tools should be hidden but found: ${present.join(", ")}`);
    }
    console.log(`  Write tools correctly hidden (${WRITE_TOOLS.join(", ")})`);
  });

  // Test 25: read tools still present
  await runTest("read-only mode: read tools still available", async () => {
    const toolNames = await listToolNames(roClient);
    const missing = READ_TOOLS.filter((t) => !toolNames.includes(t));
    if (missing.length > 0) {
      throw new Error(`Read tools should be available but missing: ${missing.join(", ")}`);
    }
    console.log(`  All ${READ_TOOLS.length} read tools available`);
  });

  // Test 26: calling a write tool returns a clear read-only error
  await runTest("read-only mode: write tool call returns read-only error", async () => {
    const errText = await callToolExpectError(roClient, "insert_data", {
      table_name: "any_table",
      data: { col: "val" },
    });
    if (!errText.toLowerCase().includes("read-only")) {
      throw new Error(`Expected read-only error but got: ${errText}`);
    }
    console.log(`  Correctly blocked: ${errText}`);
  });

  await roClient.close();

  // Summary
  console.log(colors.blue("\n" + "=".repeat(60)));
  console.log(colors.blue("Test Summary"));
  console.log(colors.blue("=".repeat(60)));
  console.log(colors.green(`✓ Passed: ${testsPassed}`));
  if (testsFailed > 0) {
    console.log(colors.red(`✗ Failed: ${testsFailed}`));
  }
  console.log(colors.blue("=".repeat(60)));

  // Close connection
  await client.close();

  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(colors.red("\n❌ Test suite error:"), error);
  process.exit(1);
});
