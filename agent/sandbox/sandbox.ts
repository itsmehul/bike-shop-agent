import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Pin just-bash locally so WhatsApp (and web) turns don't depend on Docker
// pulling ghcr.io/vercel/eve. The workspace/ seed still mounts as /workspace.
export default defineSandbox({
  backend: justbash(),
});
