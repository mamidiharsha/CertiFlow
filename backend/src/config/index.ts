import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/certiflow?schema=public',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'certiflow-super-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  demoMode: process.env.DEMO_MODE === 'true',
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost',
  whatsappApiUrl: process.env.WHATSAPP_API_URL || 'http://localhost:3001/api/send',
  slaHours: parseInt(process.env.SLA_HOURS || '48', 10),
  qualityThreshold: parseInt(process.env.QUALITY_THRESHOLD || '50', 10),
  districtQuorum: parseInt(process.env.DISTRICT_QUORUM || '2', 10),
} as const;

if (
  process.env.NODE_ENV === 'production' &&
  !config.demoMode &&
  (
    !process.env.JWT_SECRET ||
    process.env.JWT_SECRET.length < 32 ||
    process.env.JWT_SECRET === 'certiflow-super-secret-key-change-in-production'
  )
) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters');
}

export type Config = typeof config;
