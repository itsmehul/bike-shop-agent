import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  loadPrincipalTools,
  requirePrincipalId,
  summarizeTool,
} from "../lib/user-tools.js";

export default defineTool({
  description:
    "List durable custom tools belonging to the signed-in user (user__* tools).",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const principalId = requirePrincipalId(ctx);
    const tools = loadPrincipalTools(principalId).map(summarizeTool);
    return { count: tools.length, tools };
  },
});
