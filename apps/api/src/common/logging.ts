import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';

/**
 * Structured JSON logs. Every line carries a request id; booking ids are added with
 * `logger.assign({ bookingId })` inside handlers (PRD 19.6).
 */
export const loggerParams: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: (req: IncomingMessage) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    customProps: (req: IncomingMessage) => ({
      requestId: (req as IncomingMessage & { id: string }).id,
    }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-airwheels-signature"]',
        'req.headers.cookie',
      ],
      censor: '[redacted]',
    },
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
  },
};
