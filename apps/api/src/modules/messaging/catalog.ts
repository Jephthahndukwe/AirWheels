/**
 * Traveller message catalogue (PRD 7.1, 7.3, 16.2). Pure data and functions, no I/O.
 *
 * Every event has a default body per channel. Airlines override them with MessageTemplate rows
 * edited in the admin. Every body is checked by `checkTemplate` before it is saved or sent, so a
 * template can never carry anything a stranger could use (full address, full name, someone else's
 * pickup code).
 */

export type ReplyIntent =
  | 'CONFIRM'
  | 'CHANGE_TIME'
  | 'CANCEL'
  | 'COMING_OUT'
  | 'FIVE_MINUTES'
  | 'CALL_DRIVER'
  | 'LANDED'
  | 'GETTING_BAGS'
  | 'AT_MEETING_POINT'
  | 'RATE_5'
  | 'REPORT_PROBLEM';

export interface Button {
  intent: ReplyIntent;
  title: string; // WhatsApp quick-reply titles are at most 20 characters
}

export interface EventDef {
  event: string;
  label: string;
  /** Default WhatsApp body. SMS uses `sms` when given, else the same body. */
  body: string;
  sms?: string;
  buttons?: Button[];
  /** Started by us, so outside the 24-hour window it needs an approved template (PRD 7.3). */
  initiated: boolean;
  /** Driver arrived goes by WhatsApp and SMS together (PRD 16.2). */
  bothChannels?: boolean;
  /** Also email a receipt when the traveller gave an email. */
  emailSubject?: string;
}

const B = (intent: ReplyIntent, title: string): Button => ({ intent, title });

export const EVENTS: EventDef[] = [
  {
    event: 'booking.confirmed',
    label: 'Transfer confirmed',
    body: '{{serviceName}}: hi {{firstName}}, your transfer is confirmed. {{legsSummary}}. Pickup code {{pickupCode}} (only give it to your driver). Track, change or cancel: {{trackingUrl}}',
    initiated: true,
    emailSubject: 'Your transfer is confirmed',
  },
  {
    event: 'pickup_time.set',
    label: 'Your pickup time',
    body: "{{serviceName}}: we'll pick you up at {{pickupTime}} from {{pickupArea}}. {{trackingUrl}}",
    initiated: true,
  },
  {
    event: 'pickup_time.changed',
    label: 'Your pickup time changed',
    body: '{{serviceName}}: your pickup time is now {{pickupTime}} ({{reason}}). {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'driver.assigned',
    label: 'Driver assigned (night before)',
    body: '{{serviceName}}: {{driverFirstName}} will pick you up at {{pickupTime}} from {{pickupArea}} in a {{carColour}} {{car}}, plate {{plate}}. Pickup code {{pickupCode}}. Photo and tracking: {{trackingUrl}}',
    buttons: [B('CONFIRM', 'Confirm'), B('CHANGE_TIME', 'Change time'), B('CANCEL', 'Cancel')],
    initiated: true,
  },
  {
    event: 'driver.en_route',
    label: 'Driver on the way',
    body: '{{serviceName}}: {{driverFirstName}} is on the way, about {{minutesAway}} minutes away. Track: {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'driver.arrived',
    label: 'Driver outside',
    body: '{{serviceName}}: {{driverFirstName}} is outside in a {{carColour}} {{car}}, plate {{plate}}. {{meetingPoint}}. Your pickup code is {{pickupCode}}. {{trackingUrl}}',
    buttons: [
      B('COMING_OUT', "I'm coming out"),
      B('FIVE_MINUTES', 'Give me 5 minutes'),
      B('CALL_DRIVER', 'Call driver'),
    ],
    initiated: true,
    bothChannels: true,
  },
  {
    event: 'trip.completed',
    label: 'Thank you',
    body: '{{serviceName}}: thank you for riding with us, {{firstName}}. Receipt and rating: {{trackingUrl}}',
    buttons: [B('RATE_5', 'Rate 5 stars'), B('REPORT_PROBLEM', 'Report a problem')],
    initiated: true,
    emailSubject: 'Your transfer receipt',
  },
  {
    event: 'arrival.confirmed',
    label: 'Arrival pickup confirmed (before boarding)',
    body: '{{serviceName}}: your ride from the airport is booked. Driver details will come when you land. Meeting point: {{meetingPoint}}. {{trackingUrl}}',
    buttons: [B('LANDED', "I've landed")],
    initiated: true,
  },
  {
    event: 'arrival.driver_assigned',
    label: 'Your driver for arrival',
    body: '{{serviceName}}: {{driverFirstName}} is your driver, in a {{carColour}} {{car}}, plate {{plate}}. Meet at {{meetingPoint}}. Pickup code {{pickupCode}}. {{trackingUrl}}',
    buttons: [
      B('GETTING_BAGS', 'Getting my bags'),
      B('AT_MEETING_POINT', "I'm at meeting point"),
      B('CALL_DRIVER', 'Call driver'),
    ],
    initiated: true,
  },
  {
    event: 'flight.landed',
    label: 'Welcome',
    body: '{{serviceName}}: welcome, {{firstName}}. Your driver meets you at {{meetingPoint}} and waits {{freeWaitMinutes}} minutes free. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'flight.changed',
    label: 'Change notice (delay or cancellation)',
    body: '{{serviceName}}: your flight {{flightNumber}} changed ({{reason}}). {{options}} Any cost under your plan: {{cost}}. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'driver.replaced',
    label: 'New driver',
    body: '{{serviceName}}: your driver is now {{driverFirstName}}, in a {{carColour}} {{car}}, plate {{plate}}. Your pickup code stays {{pickupCode}}. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'shared.confirmed',
    label: 'Shared ride confirmed',
    body: "{{serviceName}}: shared ride confirmed. We're matching you with up to 2 travellers going your way. If there is no match, your ride becomes private at the same price. Pickup code {{pickupCode}}. {{trackingUrl}}",
    initiated: true,
    emailSubject: 'Your shared transfer is confirmed',
  },
  {
    event: 'shared.locked',
    label: 'Your shared ride',
    body: "{{serviceName}}: you're stop {{stopNumber}} of {{stopCount}}. Pickup at {{pickupTime}}. You'll ride with {{coTravellers}}. Driver {{driverFirstName}}, {{carColour}} {{car}}, plate {{plate}}. Your pickup code {{pickupCode}}. {{trackingUrl}}",
    initiated: true,
  },
  {
    event: 'shared.no_match',
    label: 'Your ride is now private',
    body: '{{serviceName}}: no match this time. Your ride is now private at the same price. Driver {{driverFirstName}}, {{carColour}} {{car}}, plate {{plate}}. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'shared.group_changed',
    label: 'Updated pickup time (group change)',
    body: '{{serviceName}}: your shared ride changed. New pickup time {{pickupTime}}. Your price stays the same. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'pickup_code.reissued',
    label: 'New pickup code',
    body: '{{serviceName}}: your new pickup code is {{pickupCode}}. Give it only to your driver. The old code no longer works. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'change.code',
    label: 'Change or cancel code',
    body: '{{serviceName}}: your code is {{changeCode}}. It works for 5 minutes. Never share it.',
    initiated: true,
  },
  {
    event: 'booking.changed',
    label: 'Change confirmed',
    body: '{{serviceName}}: your change is confirmed. {{legsSummary}}. Cost: {{cost}}. {{trackingUrl}}',
    initiated: true,
  },
  {
    event: 'booking.cancelled',
    label: 'Cancellation confirmed',
    body: '{{serviceName}}: your transfer is cancelled. Refund: {{cost}}. {{trackingUrl}}',
    initiated: true,
    emailSubject: 'Your transfer is cancelled',
  },
  {
    event: 'refund.issued',
    label: 'Refund issued',
    body: '{{serviceName}}: we have issued a refund of {{cost}}. {{trackingUrl}}',
    initiated: true,
    emailSubject: 'Your refund',
  },
  {
    event: 'reply.link',
    label: 'Reply with a link (inside the 24-hour window)',
    body: '{{serviceName}}: {{text}} {{trackingUrl}}',
    initiated: false,
  },
];

export const EVENT_BY_NAME = new Map(EVENTS.map((e) => [e.event, e]));

/**
 * Variables a template may use. Addresses only appear as an area (the first part of the address)
 * and names only as a first name, so a lock-screen preview gives a stranger nothing useful.
 * `pickupCode` is always the recipient's own code: co-travellers' codes are never in the variables.
 */
export const ALLOWED_VARIABLES = new Set([
  'serviceName',
  'firstName',
  'trackingUrl',
  'legsSummary',
  'pickupTime',
  'pickupArea',
  'dropoffArea',
  'pickupCode',
  'changeCode',
  'driverFirstName',
  'car',
  'carColour',
  'plate',
  'minutesAway',
  'meetingPoint',
  'freeWaitMinutes',
  'reason',
  'flightNumber',
  'options',
  'cost',
  'stopNumber',
  'stopCount',
  'coTravellers',
  'text',
]);

/** Variables whose values are secrets: masked in stored previews and limited to certain events. */
export const SECRET_VARIABLES = ['pickupCode', 'changeCode'] as const;

/** Events that may carry a pickup code. All go to the traveller who owns the code. */
const PICKUP_CODE_EVENTS = new Set([
  'booking.confirmed',
  'driver.assigned',
  'driver.arrived',
  'arrival.driver_assigned',
  'driver.replaced',
  'shared.confirmed',
  'shared.locked',
  'pickup_code.reissued',
]);

const VAR_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function variablesIn(body: string): string[] {
  return [...body.matchAll(VAR_RE)].map((m) => m[1]!);
}

/** Refuses a template that could leak anything (rules in the M3 brief and PRD 11.9). */
export function checkTemplate(event: string, body: string): string[] {
  const problems: string[] = [];
  if (!EVENT_BY_NAME.has(event)) problems.push(`Unknown event "${event}".`);
  for (const v of variablesIn(body)) {
    if (!ALLOWED_VARIABLES.has(v))
      problems.push(
        `{{${v}}} is not allowed. Use only first names and areas, never full names or addresses.`,
      );
  }
  if (variablesIn(body).includes('pickupCode') && !PICKUP_CODE_EVENTS.has(event))
    problems.push(
      'Only messages that go to the traveller who owns the pickup code may include it.',
    );
  if (variablesIn(body).includes('changeCode') && event !== 'change.code')
    problems.push('Only the change code message may include {{changeCode}}.');
  if (body.length > 1000) problems.push('Keep the message under 1000 characters.');
  return problems;
}

export function render(body: string, vars: Record<string, string | undefined>): string {
  return body
    .replace(VAR_RE, (_, k: string) => vars[k] ?? '')
    .replace(/\s+([.,])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** The stored preview: same text with every secret replaced, so ops never see codes. */
export function preview(body: string, vars: Record<string, string | undefined>): string {
  const masked = { ...vars };
  for (const k of SECRET_VARIABLES) if (masked[k]) masked[k] = '••••';
  return render(body, masked);
}

/** SMS has no buttons, so it says "Reply 1 for ..." (PRD 7.3). */
export function smsReplyHint(buttons: Button[] | undefined): string {
  if (!buttons?.length) return '';
  return 'Reply ' + buttons.map((b, i) => `${i + 1} for ${b.title}`).join(', ') + '.';
}

/** First part of an address: "12 Admiralty Way, Lekki Phase 1, Lagos" -> "Lekki Phase 1". */
export function areaOf(address: string): string {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^lagos$|^nigeria$/i.test(p));
  if (parts.length === 0) return 'your pickup point';
  // Drop a leading house number or street line when there is a broader part after it.
  const first = parts[0]!;
  return parts.length > 1 && /\d/.test(first) ? parts[1]! : first;
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

// ---------- inbound replies (TRV-13, TRV-15) ----------

/** Typed words we understand (PRD 7.3 "Free text"). Anything else goes to ops. */
const TEXT_INTENTS: [RegExp, ReplyIntent][] = [
  [/\b(landed|i have landed|i've landed|just landed)\b/i, 'LANDED'],
  [/\b(5|five)\s*(min|mins|minutes?)\b/i, 'FIVE_MINUTES'],
  [/\b(coming( out)?|on my way out|i'?m out)\b/i, 'COMING_OUT'],
  [/\b(bags?|luggage|baggage)\b/i, 'GETTING_BAGS'],
  [/\b(meeting point|i'?m here|i am here|at the exit)\b/i, 'AT_MEETING_POINT'],
  [/\b(call( the)? driver|call me)\b/i, 'CALL_DRIVER'],
  [/^\s*(confirm|confirmed|yes|ok|okay)\s*[.!]*\s*$/i, 'CONFIRM'],
];

export function matchTypedIntent(text: string): ReplyIntent | null {
  for (const [re, intent] of TEXT_INTENTS) if (re.test(text)) return intent;
  return null;
}

/** "1", " 2 ", "3." -> index into the buttons of the last SMS that offered them. */
export function smsNumberReply(text: string): number | null {
  const m = /^\s*([1-9])\s*[.)]?\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

/** WhatsApp button payloads we send: `<intent>|<notification id>`. */
export function buttonPayload(intent: ReplyIntent, notificationId: string): string {
  return `${intent}|${notificationId}`;
}

export function parseButtonPayload(
  payload: string,
): { intent: ReplyIntent; notificationId: string | null } | null {
  const [intent, id] = payload.split('|');
  const all: ReplyIntent[] = [
    'CONFIRM',
    'CHANGE_TIME',
    'CANCEL',
    'COMING_OUT',
    'FIVE_MINUTES',
    'CALL_DRIVER',
    'LANDED',
    'GETTING_BAGS',
    'AT_MEETING_POINT',
    'RATE_5',
    'REPORT_PROBLEM',
  ];
  if (!intent || !all.includes(intent as ReplyIntent)) return null;
  return {
    intent: intent as ReplyIntent,
    notificationId: id && /^[0-9a-f-]{36}$/.test(id) ? id : null,
  };
}

/** The 24-hour customer service window (PRD 7.3). */
export function insideWindow(
  lastInboundAt: Date | null | undefined,
  now: Date,
  hours = 24,
): boolean {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < hours * 3_600_000;
}
