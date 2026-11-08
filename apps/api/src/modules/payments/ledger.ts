import type { LedgerAccountType, LedgerDirection } from '@prisma/client';

/**
 * Double-entry ledger, pure part (PRD 14.4, PAY-03). Integer kobo only. A posting is a set of
 * lines whose debits equal its credits; `assertBalanced` refuses anything else before it reaches
 * the database, and a deferred Postgres trigger refuses it again at commit.
 *
 * Accounts from PRD 14.4, plus three this model needs: airport fees we pass through, and the
 * driver and car partner cost lines that their payables are booked against.
 */
export interface AccountDef {
  name: string;
  type: LedgerAccountType;
}

export const ACCOUNTS = {
  customerPayments: {
    code: 'customer_payments_received',
    name: 'Customer payments received (our channel, Paystack)',
    type: 'ASSET',
  },
  rideRevenue: { code: 'ride_revenue', name: 'Ride revenue', type: 'REVENUE' },
  driverPayable: { code: 'driver_payable', name: 'Driver payable', type: 'LIABILITY' },
  carPartnerPayable: {
    code: 'car_partner_payable',
    name: 'Car partner usage payable',
    type: 'LIABILITY',
  },
  refunds: { code: 'refunds', name: 'Refunds', type: 'EXPENSE' },
  gatewayFees: { code: 'gateway_fees', name: 'Payment gateway fees', type: 'EXPENSE' },
  disruptionReserve: { code: 'disruption_reserve', name: 'Disruption reserve', type: 'LIABILITY' },
  taxes: { code: 'taxes_payable', name: 'Taxes payable', type: 'LIABILITY' },
  airportFees: {
    code: 'airport_fees_payable',
    name: 'Airport fees payable (passed through)',
    type: 'LIABILITY',
  },
  driverCosts: { code: 'driver_costs', name: 'Driver costs', type: 'EXPENSE' },
  carPartnerCosts: { code: 'car_partner_costs', name: 'Car partner costs', type: 'EXPENSE' },
} as const satisfies Record<string, AccountDef & { code: string }>;

/** Per-airline accounts (PAY-03). */
export const airlineReceivable = (airlineId: string, airlineCode: string) => ({
  code: `airline_receivable:${airlineId}`,
  name: `Airline receivable: ${airlineCode}`,
  type: 'ASSET' as const,
});
export const airlineRevenueShare = (airlineId: string, airlineCode: string) => ({
  code: `airline_revenue_share_payable:${airlineId}`,
  name: `Airline revenue share payable: ${airlineCode}`,
  type: 'LIABILITY' as const,
});

export type Account = AccountDef & { code: string };

export interface PostingLine {
  account: Account;
  direction: LedgerDirection;
  amountKobo: number;
}

export interface Posting {
  reference: string;
  kind: string;
  bookingId?: string;
  memo?: string;
  lines: PostingLine[];
}

export class LedgerImbalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerImbalanceError';
  }
}

export function assertBalanced(p: Posting): void {
  if (p.lines.length < 2)
    throw new LedgerImbalanceError(`${p.reference}: a posting needs at least two lines.`);
  for (const l of p.lines) {
    if (!Number.isSafeInteger(l.amountKobo) || l.amountKobo <= 0) {
      throw new LedgerImbalanceError(
        `${p.reference}: every line must be a positive whole number of kobo (${l.account.code}: ${l.amountKobo}).`,
      );
    }
  }
  const sum = (d: LedgerDirection) =>
    p.lines.filter((l) => l.direction === d).reduce((s, l) => s + l.amountKobo, 0);
  const dr = sum('DEBIT');
  const cr = sum('CREDIT');
  if (dr !== cr)
    throw new LedgerImbalanceError(`${p.reference}: debits ${dr} do not equal credits ${cr}.`);
}

const dr = (account: Account, amountKobo: number): PostingLine => ({
  account,
  direction: 'DEBIT',
  amountKobo,
});
const cr = (account: Account, amountKobo: number): PostingLine => ({
  account,
  direction: 'CREDIT',
  amountKobo,
});

/** Drop zero lines (a booking with no tax has no tax line), then check the balance. */
function build(p: Posting): Posting {
  const out = { ...p, lines: p.lines.filter((l) => l.amountKobo !== 0) };
  assertBalanced(out);
  return out;
}

export interface SaleAmounts {
  /** What the traveller paid: fare + airport fee + tax. */
  totalKobo: number;
  airportFeeKobo: number;
  taxKobo: number;
  /** Airline's revenue share on this sale (0 when there is none). */
  airlineShareKobo: number;
  /** Flex disruption reserve set aside from revenue. */
  disruptionReserveKobo: number;
}

const checkSale = (s: SaleAmounts) => {
  const fare = s.totalKobo - s.airportFeeKobo - s.taxKobo;
  if (fare < s.airlineShareKobo + s.disruptionReserveKobo || fare < 0) {
    throw new LedgerImbalanceError('Revenue share and reserve cannot exceed the fare.');
  }
  return fare;
};

/**
 * Our channel (14.1): the traveller paid us through Paystack.
 *   Dr customer payments received  total
 *   Cr ride revenue                fare
 *   Cr airport fees payable        airport fee
 *   Cr taxes payable               tax
 * then the airline's share (if the agreement has one) and the Flex reserve come out of revenue,
 * and the gateway fee is an expense taken from what Paystack settles.
 */
export function ourChannelPayment(
  input: SaleAmounts & {
    reference: string;
    bookingId: string;
    gatewayFeeKobo: number;
    airline?: { id: string; code: string } | null;
  },
): Posting {
  const fare = checkSale(input);
  if (input.airlineShareKobo > 0 && !input.airline)
    throw new LedgerImbalanceError('A revenue share needs an airline.');
  return build({
    reference: input.reference,
    kind: 'payment.our_channel',
    bookingId: input.bookingId,
    memo: 'Traveller paid by Paystack',
    lines: [
      dr(ACCOUNTS.customerPayments, input.totalKobo),
      cr(ACCOUNTS.rideRevenue, fare),
      cr(ACCOUNTS.airportFees, input.airportFeeKobo),
      cr(ACCOUNTS.taxes, input.taxKobo),
      dr(ACCOUNTS.rideRevenue, input.airlineShareKobo),
      ...(input.airline
        ? [cr(airlineRevenueShare(input.airline.id, input.airline.code), input.airlineShareKobo)]
        : []),
      dr(ACCOUNTS.rideRevenue, input.disruptionReserveKobo),
      cr(ACCOUNTS.disruptionReserve, input.disruptionReserveKobo),
      dr(ACCOUNTS.gatewayFees, input.gatewayFeeKobo),
      cr(ACCOUNTS.customerPayments, input.gatewayFeeKobo),
    ],
  });
}

/**
 * Airline-collected (14.1): the airline owes us the full price and we owe it its share; the
 * settlement statement nets the two (M5).
 */
export function airlineCollectedSale(
  input: SaleAmounts & {
    reference: string;
    bookingId: string;
    airline: { id: string; code: string };
  },
): Posting {
  const fare = checkSale(input);
  return build({
    reference: input.reference,
    kind: 'sale.airline_collected',
    bookingId: input.bookingId,
    memo: 'Booking confirmed by the airline, collected by the airline',
    lines: [
      dr(airlineReceivable(input.airline.id, input.airline.code), input.totalKobo),
      cr(ACCOUNTS.rideRevenue, fare),
      cr(ACCOUNTS.airportFees, input.airportFeeKobo),
      cr(ACCOUNTS.taxes, input.taxKobo),
      dr(ACCOUNTS.rideRevenue, input.airlineShareKobo),
      cr(airlineRevenueShare(input.airline.id, input.airline.code), input.airlineShareKobo),
      dr(ACCOUNTS.rideRevenue, input.disruptionReserveKobo),
      cr(ACCOUNTS.disruptionReserve, input.disruptionReserveKobo),
    ],
  });
}

/**
 * Refund (14.5). Paystack route: money leaves our Paystack balance. Airline route: an adjustment
 * that reduces what the airline owes us on its next statement.
 */
export function refund(input: {
  reference: string;
  bookingId: string;
  amountKobo: number;
  route: 'PAYSTACK' | 'AIRLINE';
  airline?: { id: string; code: string } | null;
}): Posting {
  if (input.route === 'AIRLINE' && !input.airline)
    throw new LedgerImbalanceError('An airline refund needs the airline.');
  const credit =
    input.route === 'PAYSTACK'
      ? ACCOUNTS.customerPayments
      : airlineReceivable(input.airline!.id, input.airline!.code);
  return build({
    reference: input.reference,
    kind: `refund.${input.route.toLowerCase()}`,
    bookingId: input.bookingId,
    memo:
      input.route === 'PAYSTACK'
        ? 'Refund to the original payment method'
        : 'Refund adjustment on the airline statement',
    lines: [dr(ACCOUNTS.refunds, input.amountKobo), cr(credit, input.amountKobo)],
  });
}

/** A completed leg (M4 calls this): what we owe the driver and the car partner for it. */
export function legCompleted(input: {
  reference: string;
  bookingId: string;
  driverKobo: number;
  carPartnerKobo: number;
}): Posting {
  return build({
    reference: input.reference,
    kind: 'leg.completed',
    bookingId: input.bookingId,
    memo: 'Driver earning and car partner usage for a completed leg',
    lines: [
      dr(ACCOUNTS.driverCosts, input.driverKobo),
      cr(ACCOUNTS.driverPayable, input.driverKobo),
      dr(ACCOUNTS.carPartnerCosts, input.carPartnerKobo),
      cr(ACCOUNTS.carPartnerPayable, input.carPartnerKobo),
    ],
  });
}
