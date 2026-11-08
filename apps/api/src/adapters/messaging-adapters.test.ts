import { describe, expect, it } from 'vitest';
import { callbackKeyValid, dialXml } from './africastalking';
import { parseTermiiWebhook, termiiSignature, termiiSignatureValid } from './termii';
import { metaSignature, metaSignatureValid, parseMetaWebhook } from './whatsapp-cloud';

describe('WhatsApp Cloud API webhook', () => {
  it('checks the HMAC-SHA256 signature over the raw body', () => {
    const raw = Buffer.from('{"a":1}');
    expect(metaSignatureValid(raw, metaSignature(raw, 's3cret'), 's3cret')).toBe(true);
    expect(metaSignatureValid(raw, metaSignature(raw, 'other'), 's3cret')).toBe(false);
    expect(metaSignatureValid(raw, undefined, 's3cret')).toBe(false);
    expect(metaSignatureValid(raw, metaSignature(raw, ''), '')).toBe(false);
  });

  it('reads statuses, button taps, interactive replies and text', () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'w1', status: 'delivered' },
                  {
                    id: 'w2',
                    status: 'failed',
                    errors: [{ code: 131026, title: 'Undeliverable' }],
                  },
                  { id: 'w3', status: 'weird' },
                ],
                messages: [
                  {
                    id: 'm1',
                    from: '2348012345678',
                    timestamp: '1700000000',
                    type: 'button',
                    button: { payload: 'CONFIRM|x', text: 'Confirm' },
                    context: { id: 'w1' },
                  },
                  {
                    id: 'm2',
                    from: '2348012345678',
                    type: 'interactive',
                    interactive: { button_reply: { id: 'RATE_5|y', title: 'Rate 5 stars' } },
                  },
                  { id: 'm3', from: '2348012345678', type: 'text', text: { body: 'landed' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const r = parseMetaWebhook(body);
    expect(r.statuses).toEqual([
      { providerMessageId: 'w1', status: 'DELIVERED', error: undefined },
      { providerMessageId: 'w2', status: 'FAILED', error: '131026 Undeliverable' },
    ]);
    expect(r.messages.map((m) => [m.from, m.buttonPayload, m.text, m.contextId])).toEqual([
      ['+2348012345678', 'CONFIRM|x', 'Confirm', 'w1'],
      ['+2348012345678', 'RATE_5|y', 'Rate 5 stars', undefined],
      ['+2348012345678', undefined, 'landed', undefined],
    ]);
    expect(parseMetaWebhook(null)).toEqual({ statuses: [], messages: [] });
  });
});

describe('Termii webhook', () => {
  it('checks the HMAC-SHA512 signature', () => {
    const raw = Buffer.from('{}');
    expect(termiiSignatureValid(raw, termiiSignature(raw, 'k'), 'k')).toBe(true);
    expect(termiiSignatureValid(raw, termiiSignature(raw, 'x'), 'k')).toBe(false);
  });
  it('reads delivery reports and inbound replies', () => {
    expect(
      parseTermiiWebhook({ type: 'outbound', message_id: '9', status: 'Delivered' }).statuses,
    ).toEqual([{ providerMessageId: '9', status: 'DELIVERED', error: undefined }]);
    expect(parseTermiiWebhook({ message_id: '9', status: 'Rejected' }).statuses[0]?.status).toBe(
      'FAILED',
    );
    const m = parseTermiiWebhook({
      type: 'inbound',
      id: '5',
      sender: '2348012345678',
      message: '1',
    }).messages[0];
    expect(m).toMatchObject({ providerMessageId: 'termii:5', from: '+2348012345678', text: '1' });
  });
});

describe("Africa's Talking voice", () => {
  it('needs the callback secret', () => {
    expect(callbackKeyValid('abc', 'abc')).toBe(true);
    expect(callbackKeyValid('abd', 'abc')).toBe(false);
    expect(callbackKeyValid(undefined, 'abc')).toBe(false);
    expect(callbackKeyValid('', '')).toBe(false);
  });
  it('dials the other party showing our number, escaped', () => {
    const x = dialXml('+234801"><Reject/>', '+2342000');
    expect(x).toContain('callerId="+2342000"');
    expect(x).not.toContain('"><Reject/>');
  });
});
