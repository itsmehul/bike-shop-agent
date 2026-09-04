import { defineDynamic, defineInstructions } from "eve/instructions";
import { loadPrincipalTools, toolNameForSlug } from "../lib/user-tools.js";

/** Remind the model which durable user tools exist this turn. */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) => {
      const principalId = ctx.session.auth.current?.principalId;
      if (!principalId) return null;

      const tools = loadPrincipalTools(principalId);
      if (tools.length === 0) {
        return defineInstructions({
          content:
            "This signed-in user has no durable custom tools yet. " +
            "If they ask for a reusable calculator/converter/helper, create one with create_user_tool " +
            "(bash script using $ARG_<field> env vars; real bash/awk/jq available in the sandbox), " +
            "then run it via run_user_tool or user__<slug>. " +
            "Do not solve those requests with ad-hoc bash once a tool exists.",
        });
      }

      const lines = tools.map((tool) => {
        const schema = tool.inputSchemaJson;
        return `- ${toolNameForSlug(tool.slug)} (slug: ${tool.slug}): ${tool.description} Inputs: ${schema}`;
      });

      return defineInstructions({
        content: [
          "Durable custom tools for this user (sandbox bash). Prefer calling them directly:",
          ...lines,
          "If a user__* tool is not in the tool list, call run_user_tool with the slug.",
          "Do not reimplement these with the bash tool.",
          "When a tool returns a result, reply to the customer with only the useful answer.",
          "Never mention ARG_*, TOOL_INPUT, JSON parsing, debug scripts, or how tools are wired.",
        ].join("\n"),
      });
    },
  },
});
