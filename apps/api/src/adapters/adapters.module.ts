import { Global, Logger, Module, type Provider } from '@nestjs/common';
import { fakeProvidersAllowedEnv } from '../common/env';
import { AfricasTalkingVoice } from './africastalking';
import { PaystackPayments } from './paystack';
import { TermiiSms } from './termii';
import { WhatsAppCloud } from './whatsapp-cloud';
import {
  FakeEmail,
  FakeFlightStatus,
  FakeKyc,
  FakeMaps,
  FakePayments,
  FakePush,
  FakeSms,
  FakeStorage,
  FakeVoice,
  FakeWhatsApp,
} from './fakes';
import {
  EMAIL,
  FLIGHT_STATUS,
  KYC,
  MAPS,
  PAYMENTS,
  PUSH,
  SMS,
  STORAGE,
  VOICE,
  WHATSAPP,
} from './interfaces';

/**
 * Binds each adapter token to an implementation (PRD 21).
 *
 * ADAPTERS_MODE=live picks the live adapter for each provider whose keys are set. Fakes are a
 * development shortcut (ACC-12): they are allowed only in development and in the test runner.
 * Anywhere else (staging, production, or NODE_ENV unset) the API refuses to start rather than
 * quietly faking SMS, payments or KYC.
 */
export interface AdapterBinding {
  token: symbol;
  name: string;
  fake: new () => object;
  requiredEnv: string[];
}

export const bindings: AdapterBinding[] = [
  { token: PAYMENTS, name: 'Paystack', fake: FakePayments, requiredEnv: ['PAYSTACK_SECRET_KEY'] },
  {
    token: WHATSAPP,
    name: 'WhatsApp Cloud API',
    fake: FakeWhatsApp,
    requiredEnv: ['WHATSAPP_ACCESS_TOKEN'],
  },
  {
    token: SMS,
    name: 'Termii',
    fake: FakeSms,
    requiredEnv: ['TERMII_API_KEY', 'TERMII_SENDER_ID'],
  },
  {
    token: VOICE,
    name: "Africa's Talking voice",
    fake: FakeVoice,
    requiredEnv: ['AFRICASTALKING_API_KEY'],
  },
  { token: MAPS, name: 'Google Maps', fake: FakeMaps, requiredEnv: ['GOOGLE_MAPS_API_KEY'] },
  {
    token: FLIGHT_STATUS,
    name: 'AeroDataBox',
    fake: FakeFlightStatus,
    requiredEnv: ['AERODATABOX_API_KEY'],
  },
  { token: KYC, name: 'KYC provider', fake: FakeKyc, requiredEnv: ['KYC_API_KEY'] },
  { token: EMAIL, name: 'Email', fake: FakeEmail, requiredEnv: ['EMAIL_API_KEY'] },
  { token: STORAGE, name: 'Object storage', fake: FakeStorage, requiredEnv: ['S3_ACCESS_KEY_ID'] },
  { token: PUSH, name: 'Expo push', fake: FakePush, requiredEnv: ['EXPO_ACCESS_TOKEN'] },
];

/** Live implementations register here as they are built (keyed by token). */
export const live = new Map<symbol, new () => object>([
  [PAYMENTS, PaystackPayments],
  [WHATSAPP, WhatsAppCloud],
  [SMS, TermiiSms],
  [VOICE, AfricasTalkingVoice],
]);

const log = new Logger('Adapters');

/** Pure choice of implementation, tested for every environment. */
export function chooseAdapter(
  b: AdapterBinding,
  env: Record<string, string | undefined>,
  liveImpls: Map<symbol, new () => object> = live,
): { kind: 'live' | 'fake'; impl: new () => object } {
  const Live = liveImpls.get(b.token);
  const hasKeys = b.requiredEnv.every((k) => !!env[k]);
  if (env.ADAPTERS_MODE === 'live' && Live && hasKeys) return { kind: 'live', impl: Live };
  if (fakeProvidersAllowedEnv(env.NODE_ENV)) return { kind: 'fake', impl: b.fake };
  throw new Error(
    `${b.name}: no live adapter configured (set ADAPTERS_MODE=live and ${b.requiredEnv.join(', ')}). ` +
      `Fake providers are only allowed when NODE_ENV is development or test, and it is "${env.NODE_ENV ?? 'unset'}".`,
  );
}

const providers: Provider[] = bindings.map((b) => ({
  provide: b.token,
  useFactory: () => {
    const choice = chooseAdapter(b, process.env);
    if (choice.kind === 'fake' && process.env.ADAPTERS_MODE === 'live')
      log.warn(`${b.name}: live adapter unavailable, using fake`);
    return new choice.impl();
  },
}));

@Global()
@Module({ providers, exports: bindings.map((b) => b.token) })
export class AdaptersModule {}
