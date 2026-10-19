// Pure SQL and argument helpers. No database access, so these are unit testable.

// Remove comments and normalize a query for safety checks
export function normalizeQuery(query) {
  return query
    .replace(/--[^\n]*/g, '') // Remove single-line comments (-- comment)
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments (/* comment */)
    .trim()
    .toLowerCase();
}

// Replace string literals and comments with blanks, preserving quoted
// identifiers. Used for inspection only, never for execution.
function stripSqlForInspection(query, {
  standardConformingStrings = true,
  rejectUnicodeIdentifiers = false,
} = {}) {
  let out = '';
  let i = 0;
  const n = query.length;

  while (i < n) {
    const ch = query[i];
    const next = query[i + 1];

    // Single-line comment
    if (ch === '-' && next === '-') {
      i += 2;
      while (i < n && query[i] !== '\n') i++;
      out += ' ';
      continue;
    }

    // Block comment (PostgreSQL allows nesting)
    if (ch === '/' && next === '*') {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (query[i] === '/' && query[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (query[i] === '*' && query[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      out += ' ';
      continue;
    }

    // String literal. E'...' always uses backslash escapes; ordinary strings
    // do so only when standard_conforming_strings is off.
    if (ch === "'") {
      const escaped = i > 0
        && (query[i - 1] === 'e' || query[i - 1] === 'E')
        && (i < 2 || !/[A-Za-z0-9_$"]/.test(query[i - 2]));
      i++;
      while (i < n) {
        if (query[i] === "'") {
          if (query[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if ((!standardConformingStrings || escaped) && query[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      out += "''";
      continue;
    }

    // Dollar-quoted string
    if (ch === '$') {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(query.slice(i));
      if (match) {
        const tag = match[0];
        const end = query.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        out += "''";
        continue;
      }
    }

    // Quoted identifier: preserve it so function names remain visible
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (query[j] === '"') {
          if (query[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += query.slice(i, j);
      i = j;
      continue;
    }

    // Unicode-escaped identifiers can hide a function name from inspection.
    // Read-only queries do not need them, so reject them conservatively.
    if (rejectUnicodeIdentifiers && (ch === 'u' || ch === 'U') && next === '&') {
      let j = i + 2;
      while (j < n && /\s/.test(query[j])) j++;
      if (query[j] === '"') {
        throw new Error('Unicode-escaped identifiers are not allowed in read-only mode');
      }
    }

    out += ch;
    i++;
  }

  return out;
}

// Find function calls in a query so their volatility can be checked against
// pg_proc. String literals and comments are stripped first, so text such as
// the connection string passed to dblink_exec() is not mistaken for SQL.
export function extractFunctionCalls(query, options = {}) {
  const structure = stripSqlForInspection(query, {
    ...options,
    rejectUnicodeIdentifiers: true,
  });
  const calls = [];
  const seen = new Set();
  const re = /(?:(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\.\s*)?(?:"((?:[^"]|"")*)"|([A-Za-z_][A-Za-z0-9_$]*))\s*\(/g;

  let match;
  while ((match = re.exec(structure)) !== null) {
    const schema = match[1] !== undefined
      ? match[1].replace(/""/g, '"')
      : match[2] !== undefined ? match[2].toLowerCase() : null;
    const name = match[3] !== undefined
      ? match[3].replace(/""/g, '"')
      : match[4].toLowerCase();

    const key = `${schema === null ? '' : schema}\u0000${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      calls.push({ schema, name });
    }
  }

  return calls;
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
// Strings and comments are stripped in one pass, so a semicolon inside a value
// (for example WHERE col = 'a;b') is not falsely flagged, while a comment marker
// inside a string cannot hide a second statement from the check.
export function assertSingleSelect(query) {
  const structure = stripSqlForInspection(query).trim().toLowerCase();
  if (!structure.startsWith("select")) {
    throw new Error("Only SELECT queries are allowed for safety");
  }
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
