import { describe, expect, it } from 'vitest';
import {
  ACCOUNTS,
  LedgerImbalanceError,
  type Posting,
  airlineCollectedSale,
  airlineReceivable,
  airlineRevenueShare,
  assertBalanced,
  legCompleted,
  ourChannelPayment,
  refund,
} from './ledger';

const airline = { id: 'a1', code: 'MOCK' };
const sale = {
  totalKobo: 2_200_000,
  airportFeeKobo: 50_000,
  taxKobo: 150_000,
  airlineShareKobo: 200_000,
  disruptionReserveKobo: 100_000,
};

/** Net movement per account code: debits positive, credits negative. */
const net = (p: Posting) => {
  const m: Record<string, number> = {};
  for (const l of p.lines)
    m[l.account.code] =
      (m[l.account.code] ?? 0) + (l.direction === 'DEBIT' ? l.amountKobo : -l.amountKobo);
  return m;
};

describe('ledger postings (PRD 14.4, PAY-03)', () => {
  it('our channel payment: cash in, revenue, pass-throughs, airline share, reserve and gateway fee', () => {
    const p = ourChannelPayment({
      ...sale,
      reference: 'payment:1',
      bookingId: 'b1',
      gatewayFeeKobo: 43_000,
      airline,
    });
    const n = net(p);
    expect(n[ACCOUNTS.customerPayments.code]).toBe(2_200_000 - 43_000);
    expect(n[ACCOUNTS.rideRevenue.code]).toBe(-(2_000_000 - 200_000 - 100_000));
    expect(n[ACCOUNTS.airportFees.code]).toBe(-50_000);
    expect(n[ACCOUNTS.taxes.code]).toBe(-150_000);
    expect(n[airlineRevenueShare('a1', 'MOCK').code]).toBe(-200_000);
    expect(n[ACCOUNTS.disruptionReserve.code]).toBe(-100_000);
    expect(n[ACCOUNTS.gatewayFees.code]).toBe(43_000);
    expect(Object.values(n).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('our channel payment with no airline share and no tax drops the zero lines', () => {
    const p = ourChannelPayment({
      totalKobo: 1_000_000,
      airportFeeKobo: 50_000,
      taxKobo: 0,
      airlineShareKobo: 0,
      disruptionReserveKobo: 0,
      reference: 'payment:2',
      bookingId: 'b2',
      gatewayFeeKobo: 0,
    });
    expect(p.lines.every((l) => l.amountKobo > 0)).toBe(true);
    expect(p.lines.map((l) => l.account.code).sort()).toEqual(
      [ACCOUNTS.airportFees.code, ACCOUNTS.customerPayments.code, ACCOUNTS.rideRevenue.code].sort(),
    );
  });

  it('airline-collected sale: the airline owes the full price and we owe its share', () => {
    const p = airlineCollectedSale({ ...sale, reference: 'sale:1', bookingId: 'b1', airline });
    const n = net(p);
    expect(n[airlineReceivable('a1', 'MOCK').code]).toBe(2_200_000);
    expect(n[airlineRevenueShare('a1', 'MOCK').code]).toBe(-200_000);
    expect(n[ACCOUNTS.rideRevenue.code]).toBe(-1_700_000);
  });

  it('refund by Paystack reduces cash; refund through the airline reduces the receivable', () => {
    expect(
      net(
        refund({ reference: 'refund:1', bookingId: 'b1', amountKobo: 500_000, route: 'PAYSTACK' }),
      ),
    ).toEqual({
      [ACCOUNTS.refunds.code]: 500_000,
      [ACCOUNTS.customerPayments.code]: -500_000,
    });
    expect(
      net(
        refund({
          reference: 'refund:2',
          bookingId: 'b1',
          amountKobo: 500_000,
          route: 'AIRLINE',
          airline,
        }),
      ),
    ).toEqual({
      [ACCOUNTS.refunds.code]: 500_000,
      [airlineReceivable('a1', 'MOCK').code]: -500_000,
    });
    expect(() =>
      refund({ reference: 'refund:3', bookingId: 'b1', amountKobo: 1, route: 'AIRLINE' }),
    ).toThrow(LedgerImbalanceError);
  });

  it('completed leg: driver and car partner payables against their cost lines', () => {
    const n = net(
      legCompleted({
        reference: 'leg:1',
        bookingId: 'b1',
        driverKobo: 700_000,
        carPartnerKobo: 200_000,
      }),
    );
    expect(n[ACCOUNTS.driverPayable.code]).toBe(-700_000);
    expect(n[ACCOUNTS.driverCosts.code]).toBe(700_000);
    expect(n[ACCOUNTS.carPartnerPayable.code]).toBe(-200_000);
    expect(n[ACCOUNTS.carPartnerCosts.code]).toBe(200_000);
  });

  it('every account in the chart is used by some posting, and every posting balances', () => {
    const postings = [
      ourChannelPayment({
        ...sale,
        reference: 'p',
        bookingId: 'b',
        gatewayFeeKobo: 1_000,
        airline,
      }),
      airlineCollectedSale({ ...sale, reference: 's', bookingId: 'b', airline }),
      refund({ reference: 'r', bookingId: 'b', amountKobo: 1, route: 'PAYSTACK' }),
      legCompleted({ reference: 'l', bookingId: 'b', driverKobo: 1, carPartnerKobo: 1 }),
    ];
    const used = new Set(postings.flatMap((p) => p.lines.map((l) => l.account.code)));
    for (const a of Object.values(ACCOUNTS)) expect(used.has(a.code)).toBe(true);
    expect(used.has(airlineReceivable('a1', 'MOCK').code)).toBe(true);
    expect(used.has(airlineRevenueShare('a1', 'MOCK').code)).toBe(true);
    for (const p of postings) expect(() => assertBalanced(p)).not.toThrow();
  });

  it('refuses anything that does not balance, and any zero, negative or fractional line', () => {
    const line = (direction: 'DEBIT' | 'CREDIT', amountKobo: number) => ({
      account: ACCOUNTS.rideRevenue,
      direction,
      amountKobo,
    });
    expect(() =>
      assertBalanced({
        reference: 'x',
        kind: 'x',
        lines: [line('DEBIT', 100), line('CREDIT', 99)],
      }),
    ).toThrow(/do not equal/);
    expect(() =>
      assertBalanced({ reference: 'x', kind: 'x', lines: [line('DEBIT', 100)] }),
    ).toThrow(/two lines/);
    expect(() =>
      assertBalanced({ reference: 'x', kind: 'x', lines: [line('DEBIT', 0), line('CREDIT', 0)] }),
    ).toThrow(/positive/);
    expect(() =>
      assertBalanced({ reference: 'x', kind: 'x', lines: [line('DEBIT', -5), line('CREDIT', -5)] }),
    ).toThrow(/positive/);
    expect(() =>
      assertBalanced({
        reference: 'x',
        kind: 'x',
        lines: [line('DEBIT', 10.5), line('CREDIT', 10.5)],
      }),
    ).toThrow(/whole/);
    expect(() =>
      ourChannelPayment({
        ...sale,
        airlineShareKobo: 3_000_000,
        reference: 'x',
        bookingId: 'b',
        gatewayFeeKobo: 0,
        airline,
      }),
    ).toThrow(LedgerImbalanceError);
  });
});
