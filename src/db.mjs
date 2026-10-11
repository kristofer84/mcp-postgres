import { Client } from "pg";
import { loadConfig } from "./config.mjs";

// Fail fast on an unreachable host instead of hanging
const DB_CONNECT_TIMEOUT_MS = parseInt(process.env.DB_CONNECT_TIMEOUT_MS) || 10000;

let db = null;
let dbConfig = null;
// Track health explicitly instead of reading pg internals
let isConnected = false;
let reconnectPromise = null;

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

export async function closeConnection() {
  if (db) await db.end();
}
