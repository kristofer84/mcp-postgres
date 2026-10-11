// Pure SQL and argument helpers. No database access, so these are unit testable.

// Remove comments and normalize a query for safety checks
export function normalizeQuery(query) {
  return query
    .replace(/--[^\n]*/g, '') // Remove single-line comments (-- comment)
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments (/* comment */)
    .trim()
    .toLowerCase();
}

// Quote a PostgreSQL identifier (table/column name) to prevent SQL injection
export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Validate a PostgreSQL column/data type (e.g. VARCHAR(100), INTEGER, DECIMAL(10,2))
export function sanitizeType(type) {
  if (!/^[a-zA-Z0-9\s(),._[\]]+$/.test(type)) {
    throw new Error(`Invalid column type: ${type}`);
  }
  return type;
}

// Validate a column default value. Block statement terminators and comment sequences
export function sanitizeDefault(val) {
  if (/;|--|\/\*|\*\//.test(val)) {
    throw new Error(`Invalid default value: ${val}`);
  }
  return val;
}

// Allow a single SELECT statement only.
// Comments are stripped first, then string literals, so a semicolon inside a value
// (for example WHERE col = 'a;b') is not falsely flagged.
export function assertSingleSelect(query) {
  const normalized = normalizeQuery(query);
  if (!normalized.startsWith("select")) {
    throw new Error("Only SELECT queries are allowed for safety");
  }
  const structure = normalized.replace(/'(?:[^']|'')*'/g, "''");
  if (structure.includes(";")) {
    throw new Error("Multi-statement queries are not allowed");
  }
}

// Runtime validation helpers. The client-supplied inputSchema is advisory only.
export function requireString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    throw new Error(`${label} must be a non-empty object`);
  }
  return value;
}

export function optionalObject(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

export function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
