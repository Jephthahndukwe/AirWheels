import { Global, Logger, Module, type Provider } from '@nestjs/common';
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
 * Binds each adapter token to an implementation.
 * Only fakes exist in this milestone. When ADAPTERS_MODE=live, each live adapter is added
 * to `live` below and selected only if its env keys are present; otherwise the fake is used.
 */
const bindings: { token: symbol; name: string; fake: new () => object; requiredEnv: string[] }[] = [
  { token: PAYMENTS, name: 'Paystack', fake: FakePayments, requiredEnv: ['PAYSTACK_SECRET_KEY'] },
  { token: WHATSAPP, name: 'WhatsApp Cloud API', fake: FakeWhatsApp, requiredEnv: ['WHATSAPP_ACCESS_TOKEN'] },
  { token: SMS, name: 'Termii', fake: FakeSms, requiredEnv: ['TERMII_API_KEY'] },
  { token: VOICE, name: "Africa's Talking voice", fake: FakeVoice, requiredEnv: ['AFRICASTALKING_API_KEY'] },
  { token: MAPS, name: 'Google Maps', fake: FakeMaps, requiredEnv: ['GOOGLE_MAPS_API_KEY'] },
  { token: FLIGHT_STATUS, name: 'AeroDataBox', fake: FakeFlightStatus, requiredEnv: ['AERODATABOX_API_KEY'] },
  { token: KYC, name: 'KYC provider', fake: FakeKyc, requiredEnv: ['KYC_API_KEY'] },
  { token: EMAIL, name: 'Email', fake: FakeEmail, requiredEnv: ['EMAIL_API_KEY'] },
  { token: STORAGE, name: 'Object storage', fake: FakeStorage, requiredEnv: ['S3_ACCESS_KEY_ID'] },
  { token: PUSH, name: 'Expo push', fake: FakePush, requiredEnv: ['EXPO_ACCESS_TOKEN'] },
];

/** Live implementations register here as they are built (keyed by token). */
const live = new Map<symbol, new () => object>();

const log = new Logger('Adapters');

const providers: Provider[] = bindings.map(({ token, name, fake, requiredEnv }) => ({
  provide: token,
  useFactory: () => {
    const wantLive = process.env.ADAPTERS_MODE === 'live';
    const hasKeys = requiredEnv.every((k) => !!process.env[k]);
    const Live = live.get(token);
    if (wantLive && hasKeys && Live) return new Live();
    if (wantLive) log.warn(`${name}: live adapter unavailable (missing keys or not built), using fake`);
    return new fake();
  },
}));

@Global()
@Module({ providers, exports: bindings.map((b) => b.token) })
export class AdaptersModule {}
