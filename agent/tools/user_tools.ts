import { defineDynamic, defineTool } from "eve/tools";
import {
  loadPrincipalTools,
  runUserToolScript,
  toolNameForSlug,
} from "../lib/user-tools.js";

/**
 * Re-resolve before every model call so create/update/delete are visible
 * mid-session without waiting for a new conversation.
 */
export default defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const principalId = ctx.session.auth.current?.principalId;
      if (!principalId) return null;

      const tools = loadPrincipalTools(principalId);
      if (tools.length === 0) return null;

      const map: Record<string, ReturnType<typeof defineTool>> = {};

      for (const tool of tools) {
        const slug = tool.slug;
        const script = tool.script;
        const description = tool.description;
        let inputSchema: Record<string, unknown>;
        try {
          inputSchema = JSON.parse(tool.inputSchemaJson) as Record<
            string,
            unknown
          >;
        } catch {
          continue;
        }

        const name = toolNameForSlug(slug);
        map[name] = defineTool({
          description: `${description} (user-authored sandbox Python tool).`,
          // Plain JSON Schema object; cast satisfies eve's JsonObject overload.
          inputSchema: inputSchema as { type: "object" },
          async execute(input, toolCtx) {
            const result = await runUserToolScript({
              slug,
              script,
              input,
              ctx: toolCtx,
            });
            if (result.exitCode !== 0) {
              return {
                ok: false,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
              };
            }
            return {
              ok: true,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
            };
          },
        }) as ReturnType<typeof defineTool>;
      }

      return Object.keys(map).length > 0 ? map : null;
    },
  },
});
