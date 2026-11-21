import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/certiflow?schema=public',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'certiflow-super-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  whatsappApiUrl: process.env.WHATSAPP_API_URL || 'http://localhost:3001/api/send',
  slaHours: parseInt(process.env.SLA_HOURS || '48', 10),
  qualityThreshold: parseInt(process.env.QUALITY_THRESHOLD || '50', 10),
  districtQuorum: parseInt(process.env.DISTRICT_QUORUM || '2', 10),
} as const;

export type Config = typeof config;
