import { openrouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

export default defineAgent({
  model: openrouter("anthropic/claude-opus-4.8"),
  modelContextWindowTokens: 1_000_000,
});
