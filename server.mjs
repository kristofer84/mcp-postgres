#!/usr/bin/env node

import fs from "fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { initializeApp, ensureConnection, getDb, closeConnection } from "./src/db.mjs";
import { listTools, callTool, isToolBlocked } from "./src/tools/index.mjs";

// Package metadata, so the server reports its real name and version
let pkg = { name: "mcp-postgres", version: "0.0.0" };
try {
  pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf-8"));
} catch (error) {
  console.error("Could not read package.json:", error.message);
}

await initializeApp();

const server = new Server(
  {
    name: pkg.name,
    version: pkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: listTools() };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (isToolBlocked(name)) {
      throw new Error(`Tool '${name}' is disabled: server is running in read-only mode (DB_READ_ONLY=true)`);
    }

    // Ensure connection is alive before executing any query
    await ensureConnection();

    return await callTool(name, args, getDb());
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

// Close the database connection and exit cleanly
let shuttingDown = false;
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`Shutting down (${reason})...`);

  try {
    await closeConnection();
  } catch (error) {
    console.error('Error closing database connection:', error.message);
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// The MCP stdio transport does not emit close on stdin EOF, so exit here
process.stdin.on('end', () => shutdown('stdin closed'));
process.stdin.on('close', () => shutdown('stdin closed'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException', 1);
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Exit when the MCP client disconnects instead of lingering
  server.onclose = () => shutdown('client disconnected');
  console.error(`MCP DB Server running on stdio (${pkg.name} ${pkg.version})`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
