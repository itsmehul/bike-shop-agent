import { defineTool } from "eve/tools";
import { z } from "zod";
import { deleteUserTool } from "../lib/user-tools-store.js";
import {
  assertSlug,
  requirePrincipalId,
  toolNameForSlug,
} from "../lib/user-tools.js";

export default defineTool({
  description:
    "Delete a durable custom tool belonging to the signed-in user. " +
    "It disappears from the tool list on the next model step.",
  inputSchema: z.object({
    slug: z.string().describe("Tool slug to delete (without the user__ prefix)."),
  }),
  async execute({ slug }, ctx) {
    const principalId = requirePrincipalId(ctx);
    const cleanSlug = assertSlug(slug);
    const deleted = deleteUserTool(principalId, cleanSlug);
    if (!deleted) {
      throw new Error(`Tool "${cleanSlug}" not found.`);
    }
    return { deleted: true, name: toolNameForSlug(cleanSlug) };
  },
});
