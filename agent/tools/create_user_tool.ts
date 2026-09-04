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
    "Create a durable custom tool for the signed-in user from a Python script. " +
    "Use for calculators, converters, scrapers, fetchers, and other helpers the user asks for — " +
    "not limited to bike-shop tasks. Draft slug, description, JSON Schema inputs, and a Python 3 script " +
    'that reads args with: args = json.load(open(sys.argv[1])). For HTTP use urllib.request (stdlib). ' +
    "Network is available while the tool runs. Requires approval. After save, call run_user_tool or user__<slug>.",
  inputSchema: z.object({
    slug: z
      .string()
      .describe('Short id, e.g. "nm_to_inlb" or "scrape_gallery_jobs". Becomes tool name user__<slug>.'),
    description: z
      .string()
      .describe("What the tool does, written for the model that will call it."),
    inputSchema: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .describe(
        'JSON Schema for inputs as an object or JSON string. Example: {"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}.',
      ),
    script: z
      .string()
      .describe(
        "Python 3 script body. Runtime invokes: python3 script.py <args.json>. " +
          "Read inputs with json.load(open(sys.argv[1])). Print the result on stdout. " +
          "HTTP via urllib.request is allowed during the run.",
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
