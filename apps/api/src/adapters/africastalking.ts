import { timingSafeEqual } from 'node:crypto';
import type { VoiceAdapter } from './interfaces';

/**
 * Africa's Talking voice, for masked calls (TRV-05, DRV-08). Works in the sandbox with
 * AFRICASTALKING_USERNAME=sandbox. We ring the caller from our virtual number
 * (AFRICASTALKING_VOICE_NUMBER). When they answer, Africa's Talking asks our callback
 * (/v1/webhooks/voice?key=AFRICASTALKING_CALLBACK_SECRET) what to do, and we answer with a Dial to
 * the other party, showing our number. Neither side ever sees the other's number.
 */
export class AfricasTalkingVoice implements VoiceAdapter {
  readonly mode = 'live' as const;

  async bridgeCall(input: { from: string; to: string; callLogId: string }) {
    const sandbox = (process.env.AFRICASTALKING_USERNAME ?? 'sandbox') === 'sandbox';
    const base = sandbox
      ? 'https://voice.sandbox.africastalking.com'
      : 'https://voice.africastalking.com';
    const form = new URLSearchParams({
      username: process.env.AFRICASTALKING_USERNAME ?? 'sandbox',
      callFrom: process.env.AFRICASTALKING_VOICE_NUMBER ?? '',
      callTo: input.from,
      clientRequestId: input.callLogId,
    });
    const res = await fetch(`${base}/call`, {
      method: 'POST',
      headers: {
        apiKey: process.env.AFRICASTALKING_API_KEY ?? '',
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      entries?: { status?: string; sessionId?: string; errorMessage?: string }[];
      errorMessage?: string;
    };
    const entry = json.entries?.[0];
    if (!res.ok || entry?.status !== 'Queued' || !entry.sessionId)
      throw new Error(
        `Africa's Talking ${res.status}: ${entry?.errorMessage ?? json.errorMessage ?? entry?.status ?? 'not queued'}`,
      );
    return { callId: entry.sessionId };
  }

  verifyCallback(key: string | undefined) {
    return callbackKeyValid(key, process.env.AFRICASTALKING_CALLBACK_SECRET ?? '');
  }
}

export function callbackKeyValid(given: string | undefined, secret: string): boolean {
  if (!given || !secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The voice XML that connects the answered caller to the other party, showing our number. */
export function dialXml(to: string, callerId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting you now.</Say><Dial phoneNumbers="${xmlEscape(to)}" callerId="${xmlEscape(callerId)}" record="false" sequential="true"/></Response>`;
}

export const hangupXml = (say: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xmlEscape(say)}</Say><Reject/></Response>`;
