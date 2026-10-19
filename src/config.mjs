import fs from "fs";
import path from "path";
import { buildSslConfig } from "./ssl.mjs";

// Read-only mode is a process-wide setting, not just a tool-list filter.
export const READ_ONLY_MODE = process.env.DB_READ_ONLY === 'true' || process.env.DB_READ_ONLY === '1';

// Load configuration from environment variables, DATABASE_URL, or config.json
export async function loadConfig() {
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
