import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DeliveryState,
  InboundMessage,
  ReplyButton,
  SendResult,
  StatusUpdate,
  WhatsAppAdapter,
} from './interfaces';

/**
 * WhatsApp Cloud API (Meta). Works with Meta's free test number: set WHATSAPP_ACCESS_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN. Recipients of the test
 * number must be added in the Meta app dashboard first.
 *
 * Message bodies and phone numbers are never logged; only Meta's message ids are.
 */
const GRAPH = process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com/v21.0';

/** Meta signs webhooks with HMAC-SHA256 of the raw body: `X-Hub-Signature-256: sha256=<hex>`. */
export function metaSignatureValid(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice('sha256='.length));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const metaSignature = (rawBody: Buffer | string, appSecret: string) =>
  'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');

/** Meta wants digits only, no plus. */
const waId = (phone: string) => phone.replace(/\D/g, '');

/** Normalises Meta's webhook body into status updates and inbound messages. */
export function parseMetaWebhook(body: unknown): {
  statuses: StatusUpdate[];
  messages: InboundMessage[];
} {
  const statuses: StatusUpdate[] = [];
  const messages: InboundMessage[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const entry of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const map: Record<string, DeliveryState> = {
          sent: 'SENT',
          delivered: 'DELIVERED',
          read: 'READ',
          failed: 'FAILED',
        };
        const status = map[String(s.status)];
        if (!status || typeof s.id !== 'string') continue;
        const errors = s.errors as { code?: number; title?: string }[] | undefined;
        statuses.push({
          providerMessageId: s.id,
          status,
          error: errors?.[0]
            ? `${errors[0].code ?? ''} ${errors[0].title ?? ''}`.trim()
            : undefined,
        });
      }
      for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
        if (typeof m.id !== 'string' || typeof m.from !== 'string') continue;
        const button = m.button as { payload?: string; text?: string } | undefined;
        const interactive = m.interactive as
          { button_reply?: { id?: string; title?: string } } | undefined;
        const text = (m.text as { body?: string } | undefined)?.body;
        messages.push({
          providerMessageId: m.id,
          from: `+${waId(m.from)}`,
          text: text ?? button?.text ?? interactive?.button_reply?.title,
          buttonPayload: button?.payload ?? interactive?.button_reply?.id,
          contextId: (m.context as { id?: string } | undefined)?.id,
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
    }
  }
  return { statuses, messages };
}

export class WhatsAppCloud implements WhatsAppAdapter {
  readonly mode = 'live' as const;

  private async post(payload: object): Promise<SendResult> {
    const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { code?: number; message?: string };
    };
    if (!res.ok || !json.messages?.[0]?.id)
      throw new Error(
        `WhatsApp ${res.status}: ${json.error?.code ?? ''} ${json.error?.message ?? 'no message id'}`,
      );
    return { providerMessageId: json.messages[0].id, accepted: true };
  }

  sendTemplate(input: {
    to: string;
    template: string;
    language: string;
    params: string[];
    buttons?: ReplyButton[];
  }) {
    const components: object[] = [];
    if (input.params.length)
      components.push({
        type: 'body',
        parameters: input.params.map((text) => ({ type: 'text', text })),
      });
    (input.buttons ?? []).forEach((b, index) =>
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload: b.payload }],
      }),
    );
    return this.post({
      to: waId(input.to),
      type: 'template',
      template: { name: input.template, language: { code: input.language }, components },
    });
  }

  sendInteractive(input: { to: string; body: string; buttons: ReplyButton[] }) {
    return this.post({
      to: waId(input.to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: input.body },
        action: {
          buttons: input.buttons
            .slice(0, 3)
            .map((b) => ({ type: 'reply', reply: { id: b.payload, title: b.title } })),
        },
      },
    });
  }

  sendText(to: string, body: string) {
    return this.post({ to: waId(to), type: 'text', text: { body, preview_url: true } });
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return metaSignatureValid(rawBody, signature, process.env.WHATSAPP_APP_SECRET ?? '');
  }
}
