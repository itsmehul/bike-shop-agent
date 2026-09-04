import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { createUserTool } from "../lib/user-tools-store.js";
import {
  assertDescription,
  assertInputSchema,
  assertScript,
  assertSlug,
  requirePrincipalId,
  summarizeTool,
  toolNameForSlug,
} from "../lib/user-tools.js";

export default defineTool({
  description:
    "Create a durable custom tool for the signed-in user from a bash script. " +
    "Draft slug, description, JSON Schema inputs, and a bash script that reads " +
    "scalar args from $ARG_<field> (preferred) or JSON via jq/TOOL_INPUT/$1. " +
    "Example: awk -v nm=\"$ARG_nm\" 'BEGIN{printf \"%.4f\\n\", nm*8.850745791}'. " +
    "Requires approval. After save, call run_user_tool or user__<slug> — never raw bash for the same job.",
  inputSchema: z.object({
    slug: z
      .string()
      .describe('Short id, e.g. "nm_to_inlb". Becomes tool name user__<slug>.'),
    description: z
      .string()
      .describe("What the tool does, written for the model that will call it."),
    inputSchema: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .describe(
        'JSON Schema for inputs as an object or JSON string. Example: {"type":"object","properties":{"nm":{"type":"number"}},"required":["nm"]}.',
      ),
    script: z
      .string()
      .describe(
        "Bash script body. Prefer $ARG_<field> for scalars (exported by the runtime). " +
          "Also available: TOOL_INPUT (JSON string), $1 (path to JSON file), jq. " +
          "Print the result on stdout. Sandbox only — no network or shop APIs.",
      ),
  }),
  approval: always(),
  async execute({ slug, description, inputSchema, script }, ctx) {
    const principalId = requirePrincipalId(ctx);
    const cleanSlug = assertSlug(slug);
    const record = createUserTool(principalId, cleanSlug, {
      description: assertDescription(description),
      inputSchema: assertInputSchema(inputSchema),
      script: assertScript(script),
    });
    return {
      created: true,
      tool: summarizeTool(record),
      note:
        `Run it now with run_user_tool({ slug: "${cleanSlug}", arguments: {...} }) ` +
        `or call ${toolNameForSlug(cleanSlug)} if listed.`,
    };
  },
});
