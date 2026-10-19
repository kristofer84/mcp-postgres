import { Client } from "pg";
import { loadConfig, READ_ONLY_MODE } from "./config.mjs";

// Fail fast on an unreachable host instead of hanging
const DB_CONNECT_TIMEOUT_MS = parseInt(process.env.DB_CONNECT_TIMEOUT_MS) || 10000;

let db = null;
let dbConfig = null;
// Track health explicitly instead of reading pg internals
let isConnected = false;
let reconnectPromise = null;
// Serialize read-only query transactions: the server uses a single pg Client
let readOnlyQueue = Promise.resolve();

export function getDb() {
  return db;
}

export function getDbConfig() {
  return dbConfig;
}

export function isConnectionHealthy() {
  return isConnected;
}

// Initialize the database connection with retry logic
export async function initializeApp() {
  const config = await loadConfig();
  dbConfig = config;

  if (config.db.connectionTimeoutMillis === undefined) {
    config.db.connectionTimeoutMillis = DB_CONNECT_TIMEOUT_MS;
  }

  isConnected = false;

  // Close existing connection if any
  if (db) {
    try {
      await db.end();
    } catch (err) {
      console.error('Error closing existing connection:', err.message);
    }
    db = null;
  }

  db = new Client(config.db);

  // Mark the connection unhealthy on error so ensureConnection reconnects
  db.on('error', (err) => {
    isConnected = false;
    console.error('Database connection error:', err.message);
  });

  let retries = 3;
  while (retries > 0) {
    try {
      await db.connect();
      // Apply a default 30-second statement timeout to prevent runaway queries
      const timeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT) || 30000;
      await db.query(`SET statement_timeout = ${timeoutMs}`);

      // Enforce read-only mode at the database level too. This catches write
      // paths that bypass the tool filter (for example SELECT INTO or a
      // write-capable function called from a SELECT).
      if (READ_ONLY_MODE) {
        await db.query('SET default_transaction_read_only = on');
      }

      isConnected = true;
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

// Ensure the database connection is alive
export async function ensureConnection() {
  if (isConnected && db) return;

  console.error('Database connection lost, reconnecting...');

  // Collapse concurrent reconnects into a single attempt
  if (!reconnectPromise) {
    reconnectPromise = initializeApp().finally(() => {
      reconnectPromise = null;
    });
  }
  await reconnectPromise;
}

// Run a function inside an explicit READ ONLY transaction. This is stronger
// than the session default alone, because a query cannot use set_config() to
// switch the default off for the next statement. Calls are serialized because
// the server shares one pg Client.
export function runInReadOnlyTransaction(client, fn) {
  const run = async () => {
    let inTransaction = false;
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      inTransaction = true;
      return await fn(client);
    } finally {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch (error) {
          console.error('Error rolling back read-only transaction:', error.message);
        }
      }
      // Re-assert the session default in case the query changed it.
      try {
        await client.query('SET default_transaction_read_only = on');
      } catch (error) {
        console.error('Error restoring read-only session setting:', error.message);
      }
    }
  };

  const result = readOnlyQueue.then(run, run);
  // Keep the queue alive even when a query fails.
  readOnlyQueue = result.then(() => {}, () => {});
  return result;
}

export async function closeConnection() {
  if (db) await db.end();
}
