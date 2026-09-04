import { UnipileClient } from "unipile-node-sdk";

export const UNIPILE_ACCOUNT_ID =
  process.env.UNIPILE_ACCOUNT_ID ?? "8lHVEebtQfuCGBwgGAfW1w";

export function getUnipileClient(): UnipileClient {
  const dsn = process.env.UNIPILE_DSN_URL ?? process.env.UNIPILE_DSN;
  const token = process.env.UNIPILE_API_KEY ?? process.env.UNIPILE_ACCESS_TOKEN;
  if (!dsn || !token) {
    throw new Error("UNIPILE_DSN_URL and UNIPILE_API_KEY must be set");
  }
  return new UnipileClient(dsn, token);
}

export async function sendWhatsAppMessage(chatId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  await getUnipileClient().messaging.sendMessage(
    { chat_id: chatId, text: trimmed },
    { extra_params: { account_id: UNIPILE_ACCOUNT_ID } },
  );
}
