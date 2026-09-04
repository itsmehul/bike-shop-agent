import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { updateUserTool } from "../lib/user-tools-store.js";
import {
  assertDescription,
  assertInputSchema,
  assertScript,
  assertSlug,
  requirePrincipalId,
  summarizeTool,
} from "../lib/user-tools.js";

export default defineTool({
  description:
    "Update a durable custom tool for the signed-in user (description, input schema, and/or bash script). " +
    "Requires approval before save.",
  inputSchema: z.object({
    slug: z.string().describe("Existing tool slug (without the user__ prefix)."),
    description: z.string().optional(),
    inputSchema: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional()
      .describe(
        "Replacement JSON Schema for inputs as an object or JSON string.",
      ),
    script: z.string().optional().describe("Replacement bash script body."),
  }),
  approval: always(),
  async execute({ slug, description, inputSchema, script }, ctx) {
    const principalId = requirePrincipalId(ctx);
    const cleanSlug = assertSlug(slug);
    if (
      description === undefined &&
      inputSchema === undefined &&
      script === undefined
    ) {
      throw new Error("Provide at least one of description, inputSchema, script.");
    }
    const record = updateUserTool(principalId, cleanSlug, {
      description:
        description !== undefined ? assertDescription(description) : undefined,
      inputSchema:
        inputSchema !== undefined ? assertInputSchema(inputSchema) : undefined,
      script: script !== undefined ? assertScript(script) : undefined,
    });
    return { updated: true, tool: summarizeTool(record) };
  },
});
