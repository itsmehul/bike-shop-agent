import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

// Hosted Vercel Sandbox (real Linux microVM). Requires Vercel project
// credentials locally: `vercel link` then `vercel env pull` so
// VERCEL_OIDC_TOKEN is available. On Vercel deploys, OIDC is automatic.
// deny-all by default; user-tool runs temporarily open egress (see runUserToolScript).
export default defineSandbox({
  backend: vercel({
    networkPolicy: "deny-all",
    resources: { vcpus: 2 },
  }),
});
