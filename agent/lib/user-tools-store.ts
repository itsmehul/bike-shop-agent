import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface UserToolRecord {
  readonly principalId: string;
  readonly slug: string;
  readonly description: string;
  /** JSON Schema object (type: object) serialized as text. */
  readonly inputSchemaJson: string;
  readonly script: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserToolWrite {
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly script: string;
}

/** Prefer project root even when eve runs from a compile snapshot cwd. */
function resolveDataDir(): string {
  const fromEnv = process.env.BIKE_SHOP_DATA_DIR;
  if (fromEnv) return fromEnv;

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name;
        if (name === "bike-shop-dispatcher") {
          return path.join(dir, ".data");
        }
      } catch {
        // keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".data");
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, "user-tools.sqlite");

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tools (
      principal_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      script TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (principal_id, slug)
    );
  `);
  return db;
}

function rowToRecord(row: Record<string, unknown>): UserToolRecord {
  return {
    principalId: String(row.principal_id),
    slug: String(row.slug),
    description: String(row.description),
    inputSchemaJson: String(row.input_schema_json),
    script: String(row.script),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listUserTools(principalId: string): UserToolRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT principal_id, slug, description, input_schema_json, script, created_at, updated_at
       FROM user_tools WHERE principal_id = ? ORDER BY slug ASC`,
    )
    .all(principalId) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getUserTool(
  principalId: string,
  slug: string,
): UserToolRecord | null {
  const row = getDb()
    .prepare(
      `SELECT principal_id, slug, description, input_schema_json, script, created_at, updated_at
       FROM user_tools WHERE principal_id = ? AND slug = ?`,
    )
    .get(principalId, slug) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

export function createUserTool(
  principalId: string,
  slug: string,
  write: UserToolWrite,
): UserToolRecord {
  const existing = getUserTool(principalId, slug);
  if (existing) {
    throw new Error(
      `Tool "${slug}" already exists. Use update_user_tool or pick another slug.`,
    );
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO user_tools
        (principal_id, slug, description, input_schema_json, script, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      principalId,
      slug,
      write.description,
      JSON.stringify(write.inputSchema),
      write.script,
      now,
      now,
    );
  return getUserTool(principalId, slug)!;
}

export function updateUserTool(
  principalId: string,
  slug: string,
  write: Partial<UserToolWrite>,
): UserToolRecord {
  const existing = getUserTool(principalId, slug);
  if (!existing) {
    throw new Error(`Tool "${slug}" not found.`);
  }
  const description = write.description ?? existing.description;
  const inputSchema = write.inputSchema ?? JSON.parse(existing.inputSchemaJson);
  const script = write.script ?? existing.script;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE user_tools
       SET description = ?, input_schema_json = ?, script = ?, updated_at = ?
       WHERE principal_id = ? AND slug = ?`,
    )
    .run(
      description,
      JSON.stringify(inputSchema),
      script,
      now,
      principalId,
      slug,
    );
  return getUserTool(principalId, slug)!;
}

export function deleteUserTool(principalId: string, slug: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM user_tools WHERE principal_id = ? AND slug = ?`)
    .run(principalId, slug);
  return Number(result.changes) > 0;
}
