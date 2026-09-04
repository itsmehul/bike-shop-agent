import type { ToolContext } from "eve/tools";
import {
  getUserTool,
  listUserTools,
  type UserToolRecord,
} from "./user-tools-store.js";

export const USER_TOOL_PREFIX = "user__";

const SLUG_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_SCRIPT_BYTES = 50_000;
const MAX_DESCRIPTION_CHARS = 500;

export function requirePrincipalId(ctx: {
  session: { auth: { current?: { principalId?: string } | null } };
}): string {
  const id = ctx.session.auth.current?.principalId;
  if (!id) {
    throw new Error(
      "An authenticated user is required to create or use custom tools.",
    );
  }
  return id;
}

export function assertSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      'slug must match /^[a-z][a-z0-9_]{0,63}$/ (e.g. "nm_to_inlb").',
    );
  }
  if (slug.startsWith("user_")) {
    throw new Error('slug must not start with "user_" — the runtime adds user__.');
  }
  return slug;
}

export function toolNameForSlug(slug: string): string {
  return `${USER_TOOL_PREFIX}${slug}`;
}

export function assertDescription(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) throw new Error("description is required.");
  if (trimmed.length > MAX_DESCRIPTION_CHARS) {
    throw new Error(`description must be ≤ ${MAX_DESCRIPTION_CHARS} characters.`);
  }
  return trimmed;
}

export function assertScript(script: string): string {
  if (!script.trim()) throw new Error("script is required.");
  if (Buffer.byteLength(script, "utf8") > MAX_SCRIPT_BYTES) {
    throw new Error(`script must be ≤ ${MAX_SCRIPT_BYTES} bytes.`);
  }
  return script;
}

/** Normalize / validate a JSON Schema object for tool inputs. */
export function assertInputSchema(schema: unknown): Record<string, unknown> {
  let value = schema;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("inputSchema must be a JSON Schema object.");
    }
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error(
        "inputSchema string must be valid JSON for a JSON Schema object.",
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("inputSchema must be a JSON Schema object.");
  }
  const s = { ...(value as Record<string, unknown>) };
  if (s.type !== undefined && s.type !== "object") {
    throw new Error('inputSchema.type must be "object" when set.');
  }
  if (s.type === undefined) s.type = "object";
  return s;
}

export function summarizeTool(tool: UserToolRecord) {
  return {
    slug: tool.slug,
    name: toolNameForSlug(tool.slug),
    description: tool.description,
    inputSchema: JSON.parse(tool.inputSchemaJson) as Record<string, unknown>,
    updatedAt: tool.updatedAt,
  };
}

export function loadPrincipalTools(principalId: string): UserToolRecord[] {
  return listUserTools(principalId);
}

export function loadPrincipalTool(
  principalId: string,
  slug: string,
): UserToolRecord | null {
  return getUserTool(principalId, slug);
}

/**
 * Write the bash script + args into the sandbox and run it.
 * Scalars are exported as ARG_<key> env vars (easy in just-bash).
 * Full JSON is also available as $1 (file path) and TOOL_INPUT (string).
 */
export async function runUserToolScript(options: {
  slug: string;
  script: string;
  input: Record<string, unknown>;
  ctx: ToolContext;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const { slug, script, input, ctx } = options;
  const sandbox = await ctx.getSandbox();
  const safeCall = ctx.callId.replace(/[^a-zA-Z0-9_-]/g, "_") || "call";
  const scriptPath = `.user-tools/bin/${slug}.sh`;
  const argsPath = `.user-tools/args/${safeCall}.json`;
  const envPath = `.user-tools/args/${safeCall}.env`;

  const payload = input ?? {};
  await sandbox.writeTextFile({ path: scriptPath, content: script });
  await sandbox.writeTextFile({
    path: argsPath,
    content: JSON.stringify(payload),
  });
  await sandbox.writeTextFile({
    path: envPath,
    content: buildArgEnvFile(payload),
  });

  // Validated slug + sanitized call id only — no user-controlled shell bits.
  const result = await sandbox.run({
    command: `set -a; . ${envPath}; set +a; export TOOL_INPUT="$(cat ${argsPath})"; bash ${scriptPath} ${argsPath}`,
  });

  const exitCode =
    typeof result.exitCode === "number" ? result.exitCode : result.stderr ? 1 : 0;

  return {
    exitCode,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

/** Shell-safe ARG_* exports for scalar JSON fields. */
function buildArgEnvFile(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      lines.push(`ARG_${key}=${shellSingleQuote(String(value))}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "# no scalar args\n";
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
