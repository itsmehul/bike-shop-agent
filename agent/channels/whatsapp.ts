import { defineChannel, POST } from "eve/channels";
import { timingSafeEqual } from "node:crypto";
import {
  sendWhatsAppMessage,
  UNIPILE_ACCOUNT_ID,
} from "../lib/unipile.js";

export function whatsappContinuationToken(chatId: string): string {
  return chatId;
}

interface WhatsAppSender {
  attendee_id?: string;
  attendee_name?: string;
  attendee_provider_id?: string;
}

interface WhatsAppWebhookPayload {
  account_id?: string;
  account_type?: string;
  event?: string;
  chat_id?: string;
  message?: string;
  message_id?: string;
  is_sender?: boolean | number;
  sender?: WhatsAppSender;
}

interface PendingInputOption {
  id: string;
  label: string;
}

interface PendingInputRequest {
  requestId: string;
  prompt: string;
  options: PendingInputOption[];
  allowFreeform?: boolean;
}

interface WhatsAppState {
  chatId: string;
}

type WhatsAppContext = {
  chatId: string;
};

/** In-process HITL parking keyed by chat — same role as web approval buttons. */
const pendingByChat = new Map<string, PendingInputRequest[]>();

function webhookAuthorized(request: Request): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!secret) return true;

  const provided =
    request.headers.get("x-unipile-webhook-secret") ??
    request.headers.get("x-unipile-secret") ??
    request.headers.get("x-webhook-secret");
  if (!provided) return false;

  const expected = Buffer.from(secret);
  const received = Buffer.from(provided);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

function isOwnMessage(isSender: WhatsAppWebhookPayload["is_sender"]): boolean {
  return isSender === true || isSender === 1;
}

function inboundAuth(payload: WhatsAppWebhookPayload) {
  const sender = payload.sender;
  const principalId =
    sender?.attendee_provider_id ?? sender?.attendee_id ?? payload.chat_id ?? "unknown";
  const attributes: Record<string, string> = {};
  if (payload.chat_id) attributes.chatId = payload.chat_id;
  if (sender?.attendee_name) attributes.name = sender.attendee_name;

  return {
    authenticator: "unipile",
    principalType: "user",
    principalId,
    issuer: "whatsapp",
    attributes,
  };
}

function toWhatsAppText(message: string): string {
  return message
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

function formatInputPrompt(request: PendingInputRequest): string {
  const lines = [request.prompt.trim()];
  if (request.options.length > 0) {
    lines.push("");
    for (const option of request.options) {
      lines.push(`• Reply "${option.label}" to choose that`);
    }
  }
  if (request.allowFreeform) {
    lines.push("", "Or reply with your own answer.");
  }
  return lines.join("\n");
}

function matchPendingResponse(
  text: string,
  pending: PendingInputRequest[],
): { requestId: string; optionId?: string; text?: string } | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized || pending.length === 0) return null;

  const request = pending[0];
  for (const option of request.options) {
    const label = option.label.trim().toLowerCase();
    const id = option.id.trim().toLowerCase();
    if (
      normalized === label ||
      normalized === id ||
      (label.length > 0 && normalized.includes(label))
    ) {
      return { requestId: request.requestId, optionId: option.id };
    }
  }

  if (request.options.some((o) => o.id === "approve" || /approve|yes|confirm/i.test(o.label))) {
    if (/^(y|yes|ok|okay|approve|confirm|sure|go ahead)$/i.test(normalized)) {
      const approve = request.options.find(
        (o) => o.id === "approve" || /approve|yes|confirm/i.test(o.label),
      );
      if (approve) return { requestId: request.requestId, optionId: approve.id };
    }
  }
  if (request.options.some((o) => o.id === "deny" || /deny|no|reject|cancel/i.test(o.label))) {
    if (/^(n|no|deny|reject|cancel|stop)$/i.test(normalized)) {
      const deny = request.options.find(
        (o) => o.id === "deny" || /deny|no|reject|cancel/i.test(o.label),
      );
      if (deny) return { requestId: request.requestId, optionId: deny.id };
    }
  }

  if (request.allowFreeform || request.options.length === 0) {
    return { requestId: request.requestId, text: text.trim() };
  }

  return null;
}

async function safeReply(chatId: string, text: string): Promise<void> {
  try {
    await sendWhatsAppMessage(chatId, toWhatsAppText(text));
  } catch (error) {
    console.error("[whatsapp] failed to send reply", { chatId, error });
  }
}

export default defineChannel<WhatsAppState, WhatsAppContext, { chatId: string }>({
  kindHint: "whatsapp",
  turnPolicy: "steer",
  state: { chatId: "" },

  metadata(state) {
    return {
      chatId: state.chatId,
      audience: "private" as const,
    };
  },

  context(state) {
    return { chatId: state.chatId };
  },

  receive: async (input, { from }) => {
    const chatId = input.target.chatId;
    return from(whatsappContinuationToken(chatId)).send(input.message, {
      auth: input.auth,
      state: { chatId },
    });
  },

  routes: [
    POST("/whatsapp/webhook", async (request, { from }) => {
      if (!webhookAuthorized(request)) {
        return new Response("unauthorized", { status: 401 });
      }

      const payload = (await request.json()) as WhatsAppWebhookPayload;

      if (payload.account_id && payload.account_id !== UNIPILE_ACCOUNT_ID) {
        return new Response(null, { status: 204 });
      }
      if (payload.account_type && payload.account_type !== "WHATSAPP") {
        return new Response(null, { status: 204 });
      }
      if (payload.event && payload.event !== "message_received") {
        return new Response(null, { status: 204 });
      }
      if (!payload.chat_id || isOwnMessage(payload.is_sender)) {
        return new Response(null, { status: 204 });
      }

      const text = payload.message?.trim() ?? "";
      const token = whatsappContinuationToken(payload.chat_id);
      const source = from(token);
      const auth = inboundAuth(payload);

      if (text === "/new") {
        pendingByChat.delete(payload.chat_id);
        await source.reset({ reason: "User requested /new" });
        await safeReply(payload.chat_id, "Starting a fresh chat. How can I help with your bike?");
        return new Response(null, { status: 204 });
      }

      if (!text) {
        return new Response(null, { status: 204 });
      }

      const pending = pendingByChat.get(payload.chat_id) ?? [];
      const matched = matchPendingResponse(text, pending);
      if (matched) {
        pendingByChat.delete(payload.chat_id);
        await source.respond([matched], { auth });
        return new Response(null, { status: 204 });
      }

      await source.send(text, {
        auth,
        state: { chatId: payload.chat_id },
      });

      return new Response(null, { status: 204 });
    }),
  ],

  events: {
    "message.completed"(eventData, channel) {
      if (eventData.finishReason === "tool-calls") return;
      const chatId = channel.chatId || channel.continuation?.token;
      if (!eventData.message || !chatId) return;
      void safeReply(chatId, eventData.message);
    },

    "input.requested"(eventData, channel) {
      const chatId = channel.chatId || channel.continuation?.token;
      if (!chatId) return;

      const pending: PendingInputRequest[] = eventData.requests.map((request) => ({
        requestId: request.requestId,
        prompt: request.prompt,
        allowFreeform: request.allowFreeform,
        options: (request.options ?? []).map((option) => ({
          id: option.id,
          label: option.label,
        })),
      }));

      pendingByChat.set(chatId, pending);

      for (const request of pending) {
        void safeReply(chatId, formatInputPrompt(request));
      }
    },

    "turn.failed"(eventData, channel) {
      const chatId = channel.chatId || channel.continuation?.token;
      if (!chatId) return;
      console.error("[whatsapp] turn failed", eventData);
      void safeReply(
        chatId,
        "Sorry — I hit a snag working on that. Send your message again, or reply /new to start fresh.",
      );
    },

    "turn.cancelled"(eventData, channel) {
      const chatId = channel.chatId || channel.continuation?.token;
      if (!chatId) return;
      console.error("[whatsapp] turn cancelled", eventData);
      void safeReply(chatId, "Stopped. Send another message whenever you're ready.");
    },

    "session.failed"(eventData, channel) {
      const chatId = channel.chatId || channel.continuation?.token;
      if (!chatId) return;
      console.error("[whatsapp] session failed", eventData);
      void safeReply(
        chatId,
        "Sorry — I hit a snag working on that. Send your message again, or reply /new to start fresh.",
      );
    },
  },
});
