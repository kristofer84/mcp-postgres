/**
 * Optional SQLGuard authorize-before-mutate gate (env-gated, default OFF).
 *
 * When SQLGUARD_REQUIRE is truthy, write/DDL tools must present a verified
 * Ed25519 PASS from https://sqlguard.io before execute.
 *
 * Wealth path (not Session pennies):
 *   - Pilot Challenge unlock Exact $100 — POST /v1/challenge → /v1/challenge/unlock
 *   - Alt Exact Pilot — POST /v1/gateway/pilot ($100)
 *   - Company invoice — Gateway Starter $299/mo → hello@sqlguard.io
 *
 * Env:
 *   SQLGUARD_REQUIRE=1
 *   SQLGUARD_BASE=https://sqlguard.io
 *   SQLGUARD_AGENT=<0x wallet or agent id>
 */

const MUTATING =
  /\b(INSERT|UPDATE|DELETE|MERGE|UPSERT|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|REINDEX|CLUSTER|REFRESH)\b/i;

export function requireEnabled() {
  const raw = (process.env.SQLGUARD_REQUIRE || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

export function isMutatingSql(sql) {
  if (!sql || typeof sql !== "string") return false;
  let cleaned = sql.replace(/--.*?$/gm, " ");
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, " ");
  return MUTATING.test(cleaned);
}

function baseUrl() {
  return (process.env.SQLGUARD_BASE || "https://sqlguard.io").replace(/\/$/, "");
}

function agentId() {
  return (process.env.SQLGUARD_AGENT || "0xagent").trim();
}

function buyHint() {
  const b = baseUrl();
  return (
    `Authorize ≠ lint. Wealth unlock: Exact Pilot Challenge $100 (${b}/challenge · POST ${b}/v1/challenge/unlock amount 100000000) ` +
    `or Exact Gateway Pilot POST ${b}/v1/gateway/pilot · or invoice Gateway Starter $299/mo → hello@sqlguard.io. ` +
    `Free tip: POST ${b}/v1/gateway/decide. Probe is free and never authorizes. Docs: ${b}/GATEWAY.md`
  );
}

async function postJson(path, body, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "X-SQLGuard-Agent": agentId(),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = { raw };
    }
    if (json === null || typeof json !== "object" || Array.isArray(json)) {
      json = { value: json };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build a representative SQL string for structured write tools (for decide/verify hash).
 */
export function sqlFromWriteTool(name, args = {}) {
  if (name === "execute_raw_query") return String(args.query || "");
  if (name === "insert_data") {
    const cols = args.data && typeof args.data === "object" ? Object.keys(args.data) : [];
    return `INSERT INTO ${args.table_name || "unknown"} (${cols.join(", ")}) VALUES (...)`;
  }
  if (name === "update_data") {
    return `UPDATE ${args.table_name || "unknown"} SET ... WHERE ...`;
  }
  if (name === "delete_data") {
    return `DELETE FROM ${args.table_name || "unknown"} WHERE ...`;
  }
  if (name === "create_table") {
    return `CREATE TABLE ${args.table_name || "unknown"} (...)`;
  }
  if (name === "alter_table") {
    return `ALTER TABLE ${args.table_name || "unknown"} ...`;
  }
  return "";
}

/**
 * Returns error string if blocked, else null.
 * Optional tool args: sqlguard_certificate, sqlguard_signature
 */
export async function gateWriteTool(name, args = {}) {
  if (!requireEnabled()) return null;
  if (args?.dry_run) return null; // previews stay free

  const sql = sqlFromWriteTool(name, args);
  if (!sql || !isMutatingSql(sql)) return null;

  const certificate = args.sqlguard_certificate ?? args.certificate;
  const signature = args.sqlguard_signature ?? args.signature;

  if (!certificate || !signature) {
    // Soft tip via free decide (does not authorize execute)
    try {
      await postJson("/v1/gateway/decide", {
        sql,
        agent_id: agentId(),
        schema_ddl: args.schema_ddl || "",
      });
    } catch {
      /* tip best-effort */
    }
    return `SQLGUARD_REQUIRE: mutating tool '${name}' blocked without verified PASS. ${buyHint()}`;
  }

  let certObj;
  if (typeof certificate === "string") {
    try {
      certObj = JSON.parse(certificate);
    } catch {
      return "SQLGUARD_REQUIRE: sqlguard_certificate must be JSON object or JSON string.";
    }
  } else {
    certObj = certificate;
  }

  try {
    const { status, json } = await postJson("/v1/verify", {
      certificate: certObj,
      signature,
    });
    if (status === 200 && json.ok === true) return null;
    return `SQLGUARD_REQUIRE: verify failed (HTTP ${status}): ${JSON.stringify(json).slice(0, 400)}. ${buyHint()}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `SQLGUARD_REQUIRE: verify unreachable (${msg}). ${buyHint()}`;
  }
}
