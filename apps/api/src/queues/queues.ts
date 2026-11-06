import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

/** BullMQ queues (PRD 4.1 workers). One queue per worker family. */
export const QUEUES = {
  intake: 'intake',
  bookings: 'bookings',
  payments: 'payments',
  flights: 'flights',
  dispatch: 'dispatch',
  messaging: 'messaging',
  settlement: 'settlement',
  reconciliation: 'reconciliation',
} as const;

const redisConnection = () => {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
};

const queues = Object.values(QUEUES).map((name) =>
  BullModule.registerQueue({
    name,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: false, // failed jobs stay for the dead-letter view
    },
  }),
);

@Global()
@Module({
  imports: [BullModule.forRoot({ connection: redisConnection() }), ...queues],
  exports: queues,
})
export class QueuesModule {}
