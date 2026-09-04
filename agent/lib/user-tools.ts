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
 * Write a Python script + JSON args into the sandbox and run with python3.
 * Scripts read args via: `args = json.load(open(sys.argv[1]))`
 * Egress is opened only for the duration of the run (sandbox default stays deny-all).
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
  const scriptPath = `.user-tools/bin/${slug}.py`;
  const argsPath = `.user-tools/args/${safeCall}.json`;

  const payload = input ?? {};
  await sandbox.writeTextFile({
    path: scriptPath,
    content: normalizePythonScript(script),
  });
  await sandbox.writeTextFile({
    path: argsPath,
    content: JSON.stringify(payload),
  });

  // Open egress only while the user script runs, then lock the sandbox again.
  await sandbox.setNetworkPolicy("deny-all");
  try {
    // Validated slug + sanitized call id only — no user-controlled shell bits.
    const result = await sandbox.run({
      command: `python3 ${scriptPath} ${argsPath}`,
    });

    const exitCode =
      typeof result.exitCode === "number"
        ? result.exitCode
        : result.stderr
          ? 1
          : 0;

    return {
      exitCode,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  } finally {
    await sandbox.setNetworkPolicy("deny-all");
  }
}

/** Ensure the body is a runnable .py file (add shebang if missing). */
function normalizePythonScript(script: string): string {
  const trimmed = script.trim();
  if (trimmed.startsWith("#!")) return `${trimmed}\n`;
  return `#!/usr/bin/env python3\n${trimmed}\n`;
}
