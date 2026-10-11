import { requireString, optionalObject, clampLimit, quoteIdent, assertSingleSelect } from "../sql.mjs";
import { getCacheStatus, CERT_CACHE_DIR, AWS_RDS_CERT_URL } from "../ssl.mjs";
import { getDbConfig, isConnectionHealthy } from "../db.mjs";

const asText = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export async function getSchema(args, db) {
  let query = `
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `;

  if (args?.table_name) {
    const result = await db.query(query + ` AND table_name = $1`, [args.table_name]);
    return asText(result.rows);
  }

  const result = await db.query(query);
  return asText(result.rows);
}

export async function queryData(args, db) {
  const query = requireString(args?.query, "query");
  assertSingleSelect(query);

  const startTime = Date.now();
  const result = await db.query(query);
  const executionTime = Date.now() - startTime;

  return asText({
    rows: result.rows,
    rowCount: result.rowCount,
    execution_time_ms: executionTime,
  });
}

export async function listTables(args, db) {
  const result = await db.query(`
    SELECT table_name, table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  return asText(result.rows);
}

export async function describeTable(args, db) {
  const tableName = requireString(args?.table_name, "table_name");

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

  return asText({
    table_name: tableName,
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
  });
}

export async function getTableSample(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const limit = clampLimit(args?.limit, 10, 100); // Cap at 100 rows

  const result = await db.query(`SELECT * FROM ${quoteIdent(tableName)} LIMIT $1`, [limit]);

  return asText({
    table_name: tableName,
    sample_size: result.rows.length,
    rows: result.rows,
  });
}

export async function checkCertificateCache() {
  return asText({
    aws_rds_certificate_cache: getCacheStatus(),
    cache_directory: CERT_CACHE_DIR,
    auto_download_url: AWS_RDS_CERT_URL,
  });
}

export async function countRows(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const where = optionalObject(args?.where, "where");

  let query = `SELECT COUNT(*) as count FROM ${quoteIdent(tableName)}`;
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

  return asText({
    table_name: tableName,
    count: parseInt(result.rows[0].count),
    execution_time_ms: executionTime,
  });
}

export async function tableExists(args, db) {
  const tableName = requireString(args?.table_name, "table_name");

  const result = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    )
  `, [tableName]);

  return asText({
    table_name: tableName,
    exists: result.rows[0].exists,
  });
}

export async function columnExists(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const columnName = requireString(args?.column_name, "column_name");

  const result = await db.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = $1
      AND column_name = $2
    )
  `, [tableName, columnName]);

  return asText({
    table_name: tableName,
    column_name: columnName,
    exists: result.rows[0].exists,
  });
}

export async function getRelationships(args, db) {
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

  return asText({
    relationships: result.rows,
    count: result.rowCount,
  });
}

export async function getConnectionStatus(args, db) {
  const config = getDbConfig();
  const connectionInfo = {
    connected: isConnectionHealthy(),
    host: config?.db?.host,
    port: config?.db?.port,
    database: config?.db?.database,
    user: config?.db?.user,
    ssl_enabled: !!config?.db?.ssl,
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

  return asText(connectionInfo);
}
