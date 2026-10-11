import {
  requireString,
  requireObject,
  clampLimit,
  quoteIdent,
  sanitizeType,
  sanitizeDefault,
} from "../sql.mjs";

const asText = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export async function updateData(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const values = requireObject(args?.values ?? args?.data, "values");
  const where = requireObject(args?.where, "where");

  const quotedTable = quoteIdent(tableName);
  const limitVal = clampLimit(args?.limit, 1000, 10000);

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
      `SELECT * FROM ${quotedTable} WHERE ${whereClauseForSelect} LIMIT $${whereColumns.length + 1}`,
      [...Object.values(where), limitVal]
    );
    return asText({
      dry_run: true,
      would_update_rows: previewResult.rowCount,
      preview_rows: previewResult.rows,
      pending_values: values,
    });
  }

  // Enforce row limit via ctid subquery
  const limitParamIdx = queryParams.length + 1;
  queryParams.push(limitVal);

  const startTime = Date.now();
  const query = `UPDATE ${quotedTable} SET ${setClause} WHERE ctid IN (SELECT ctid FROM ${quotedTable} WHERE ${whereClause} LIMIT $${limitParamIdx}) RETURNING *`;
  const result = await db.query(query, queryParams);
  const executionTime = Date.now() - startTime;

  return asText({
    updated_rows: result.rowCount,
    returning: result.rows,
    execution_time_ms: executionTime,
  });
}

export async function deleteData(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const where = requireObject(args?.where, "where");

  const quotedTable = quoteIdent(tableName);
  const limitVal = clampLimit(args?.limit, 1000, 10000);

  // Build WHERE clause with quoted column names
  const whereColumns = Object.keys(where);
  const whereClause = whereColumns.map((col, idx) => `${quoteIdent(col)} = $${idx + 1}`).join(' AND ');
  const queryParams = [...Object.values(where)];

  // dry_run: preview affected rows without deleting
  if (args?.dry_run) {
    const previewResult = await db.query(
      `SELECT * FROM ${quotedTable} WHERE ${whereClause} LIMIT $${queryParams.length + 1}`,
      [...queryParams, limitVal]
    );
    return asText({
      dry_run: true,
      would_delete_rows: previewResult.rowCount,
      preview_rows: previewResult.rows,
    });
  }

  // Enforce row limit via ctid subquery
  const limitParamIdx = queryParams.length + 1;
  queryParams.push(limitVal);

  const startTime = Date.now();
  const query = `DELETE FROM ${quotedTable} WHERE ctid IN (SELECT ctid FROM ${quotedTable} WHERE ${whereClause} LIMIT $${limitParamIdx}) RETURNING *`;
  const result = await db.query(query, queryParams);
  const executionTime = Date.now() - startTime;

  return asText({
    deleted_rows: result.rowCount,
    returning: result.rows,
    execution_time_ms: executionTime,
  });
}

export async function insertData(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const data = requireObject(args?.data, "data");

  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');

  const startTime = Date.now();
  const query = `INSERT INTO ${quoteIdent(tableName)} (${columns.map(quoteIdent).join(', ')}) VALUES (${placeholders}) RETURNING *`;
  const result = await db.query(query, values);
  const executionTime = Date.now() - startTime;

  return asText({
    inserted_rows: result.rowCount,
    returning: result.rows,
    execution_time_ms: executionTime,
  });
}

export async function executeRawQuery(args, db) {
  const query = requireString(args?.query, "query");
  const params = args?.params ?? [];

  if (!Array.isArray(params)) {
    throw new Error("params must be an array");
  }

  const startTime = Date.now();
  const result = await db.query(query, params);
  const executionTime = Date.now() - startTime;

  return asText({
    rows: result.rows,
    rowCount: result.rowCount,
    command: result.command,
    execution_time_ms: executionTime,
  });
}

export async function createTable(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const columns = args?.columns;

  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error("table_name and columns array are required");
  }

  const columnDefs = columns.map(col => {
    const colName = requireString(col?.name, "column.name");
    const colType = requireString(col?.type, "column.type");
    let def = `${quoteIdent(colName)} ${sanitizeType(colType)}`;
    if (col.primary_key) def += ' PRIMARY KEY';
    if (col.unique && !col.primary_key) def += ' UNIQUE';
    if (col.nullable === false && !col.primary_key) def += ' NOT NULL';
    if (col.default !== undefined) def += ` DEFAULT ${sanitizeDefault(col.default)}`;
    return def;
  }).join(', ');

  const query = `CREATE TABLE ${quoteIdent(tableName)} (${columnDefs})`;
  const startTime = Date.now();
  await db.query(query);
  const executionTime = Date.now() - startTime;

  return asText({
    table_name: tableName,
    created: true,
    execution_time_ms: executionTime,
    query: query,
  });
}

export async function alterTable(args, db) {
  const tableName = requireString(args?.table_name, "table_name");
  const action = requireString(args?.action, "action");
  const columnName = requireString(args?.column_name, "column_name");

  const quotedTable = quoteIdent(tableName);
  let query;

  switch (action) {
    case "add_column":
      if (!args.column_type) {
        throw new Error("column_type is required for add_column");
      }
      query = `ALTER TABLE ${quotedTable} ADD COLUMN ${quoteIdent(columnName)} ${sanitizeType(args.column_type)}`;
      if (args.nullable === false) query += ' NOT NULL';
      if (args.default_value !== undefined) query += ` DEFAULT ${sanitizeDefault(args.default_value)}`;
      break;

    case "drop_column":
      query = `ALTER TABLE ${quotedTable} DROP COLUMN ${quoteIdent(columnName)}`;
      break;

    case "rename_column":
      if (!args.new_column_name) {
        throw new Error("new_column_name is required for rename_column");
      }
      query = `ALTER TABLE ${quotedTable} RENAME COLUMN ${quoteIdent(columnName)} TO ${quoteIdent(args.new_column_name)}`;
      break;

    case "alter_column_type":
      if (!args.column_type) {
        throw new Error("column_type is required for alter_column_type");
      }
      query = `ALTER TABLE ${quotedTable} ALTER COLUMN ${quoteIdent(columnName)} TYPE ${sanitizeType(args.column_type)}`;
      break;

    default:
      throw new Error(`Unknown action: ${action}`);
  }

  const startTime = Date.now();
  await db.query(query);
  const executionTime = Date.now() - startTime;

  return asText({
    table_name: tableName,
    action: action,
    success: true,
    execution_time_ms: executionTime,
    query: query,
  });
}
