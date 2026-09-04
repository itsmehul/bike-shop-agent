import { readFileSync } from "node:fs";
import { join } from "node:path";

function eveOrigin(): string {
  try {
    const raw = readFileSync(join(process.cwd(), ".eve/next-dev-server.json"), "utf8");
    const parsed = JSON.parse(raw) as { origin?: string };
    if (parsed.origin) return parsed.origin;
  } catch {
    // Eve writes this after `next dev` starts the sidecar.
  }
  return process.env.EVE_BASE_URL ?? "http://127.0.0.1:4274";
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.arrayBuffer();
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  for (const name of [
    "x-unipile-webhook-secret",
    "x-unipile-secret",
    "x-webhook-secret",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const upstream = await fetch(`${eveOrigin()}/whatsapp/webhook`, {
    method: "POST",
    headers,
    body,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "text/plain" },
  });
}
