import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  assertSlug,
  loadPrincipalTool,
  requirePrincipalId,
  runUserToolScript,
  toolNameForSlug,
} from "../lib/user-tools.js";

/**
 * Always-on executor so custom tools remain callable even if the dynamic
 * user__* registrations are missing from a given model step.
 */
export default defineTool({
  description:
    "Run one of the signed-in user's durable custom tools by slug. " +
    "Prefer the direct user__<slug> tool when it is listed; use this if it is not. " +
    "Do not reimplement the tool with bash or ad-hoc python — call this (or user__*) instead.",
  inputSchema: z.object({
    slug: z
      .string()
      .describe("Tool slug without the user__ prefix, e.g. nm_to_inlb."),
    arguments: z
      .record(z.string(), z.unknown())
      .default({})
      .describe("Arguments matching that tool's input schema."),
  }),
  async execute({ slug, arguments: args }, ctx) {
    const principalId = requirePrincipalId(ctx);
    const cleanSlug = assertSlug(slug);
    const tool = loadPrincipalTool(principalId, cleanSlug);
    if (!tool) {
      throw new Error(
        `No custom tool "${cleanSlug}" for this user. Use list_user_tools or create_user_tool.`,
      );
    }

    const result = await runUserToolScript({
      slug: cleanSlug,
      script: tool.script,
      input: (args ?? {}) as Record<string, unknown>,
      ctx,
    });

    return {
      name: toolNameForSlug(cleanSlug),
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  },
});
