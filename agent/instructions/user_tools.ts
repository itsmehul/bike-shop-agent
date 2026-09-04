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
            "If they ask for any reusable helper (calc, scrape, fetch, convert, etc.), create one with create_user_tool " +
            "(Python 3; args via json.load(open(sys.argv[1])); urllib.request for HTTP — network is on during the run). " +
            "Then run it via run_user_tool or user__<slug>. Do not refuse for being off-topic from bikes. " +
            "Do not solve those requests with ad-hoc bash/python/web_fetch once a tool exists or should be created. " +
            "If web_fetch hits the 5MB limit, create a Python user tool that filters in-sandbox instead of retrying.",
        });
      }

      const lines = tools.map((tool) => {
        const schema = tool.inputSchemaJson;
        return `- ${toolNameForSlug(tool.slug)} (slug: ${tool.slug}): ${tool.description} Inputs: ${schema}`;
      });

      return defineInstructions({
        content: [
          "Durable custom tools for this user (sandbox Python). Prefer calling them directly:",
          ...lines,
          "If a user__* tool is not in the tool list, call run_user_tool with the slug.",
          "Do not reimplement these with bash, one-off python, or web_fetch.",
          "If web_fetch says the response is too large, create/update a Python user tool that streams or filters in-sandbox instead of retrying web_fetch/curl.",
          "When a tool returns a result, reply to the customer with only the useful answer.",
          "Never mention sys.argv, JSON args files, debug scripts, or how tools are wired.",
        ].join("\n"),
      });
    },
  },
});
