export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  jwtSecret: process.env.JWT_SECRET ?? "glowos-dev-jwt-secret",
  jwtExpiry: process.env.JWT_EXPIRY ?? "15m",
  refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY ?? "30d",

  bookingTokenSecret: process.env.BOOKING_TOKEN_SECRET ?? "glowos-dev-booking-secret",

  appUrl: process.env.APP_URL ?? "http://localhost:3001",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",
  dashboardUrl: process.env.DASHBOARD_URL ?? "http://localhost:3002",

  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;
