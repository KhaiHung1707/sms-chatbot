import pino from 'pino';

/**
 * Structured JSON logging (pino). In development, pretty-print for readability;
 * in production emit raw JSON for log aggregation.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export type Logger = typeof logger;
