import { resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  
}

//_________________________________________________________________________________//

//1: getEnv
const getEnv = (name: string, fallback: string): string => {
  return process.env[name] ?? fallback;
};

//_________________________________________________________________________________//

//2: env
export const env = {
  nodeEnv: getEnv("NODE_ENV", "development"),
  port: Number(getEnv("PORT", "3000")),
  mongoUri: getEnv("MONGO_URI", "mongodb://127.0.0.1:27017/social_app"),
  redisUri: getEnv("REDIS_URI", "redis://127.0.0.1:6379"),

  accessSecret: getEnv("ACCESS_TOKEN_SECRET", "dev_access_secret_change_me"),
  refreshSecret: getEnv("REFRESH_TOKEN_SECRET", "dev_refresh_secret_change_me"),
  accessExpiresIn: Number(getEnv("ACCESS_TOKEN_EXPIRES_IN", "900")), //seconds (15 minutes)
  refreshExpiresIn: Number(getEnv("REFRESH_TOKEN_EXPIRES_IN", "604800")), //seconds (7 days)
  saltRounds: Number(getEnv("SALT_ROUNDS", "10")),

  otpExpiresIn: Number(getEnv("OTP_EXPIRES_IN", "600")), //seconds (10 minutes)
  otpMaxAttempts: Number(getEnv("OTP_MAX_ATTEMPTS", "5")),
  otpResendDelay: Number(getEnv("OTP_RESEND_DELAY", "60")), //seconds

  encryptionKey: getEnv("ENCRYPTION_KEY", ""), //64 hex characters (32 bytes), no default on purpose

  uploadsDir: resolve(getEnv("UPLOADS_DIR", "uploads")),
  maxImageSize: Number(getEnv("MAX_IMAGE_SIZE", "2097152")), //bytes (2 MB)

  corsOrigins: getEnv("CORS_ORIGINS", "").split(",").map((origin) => origin.trim()).filter(Boolean),
  trustProxy: Number(getEnv("TRUST_PROXY", "0")), //number of proxies in front of the app
  rateLimitEnabled: getEnv("RATE_LIMIT_ENABLED", "true") !== "false",

  googleClientId: getEnv("GOOGLE_CLIENT_ID", ""),

  smtpHost: getEnv("SMTP_HOST", ""),
  smtpPort: Number(getEnv("SMTP_PORT", "465")),
  smtpUser: getEnv("SMTP_USER", ""),
  smtpPass: getEnv("SMTP_PASS", ""),
  smtpFrom: getEnv("SMTP_FROM", "Social App <no-reply@socialapp.com>"),
};

//_________________________________________________________________________________//

if (env.nodeEnv === "production" && (!process.env.ACCESS_TOKEN_SECRET || !process.env.REFRESH_TOKEN_SECRET)) {
  throw new Error("ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET are required in production");
}

if (!/^[0-9a-fA-F]{64}$/.test(env.encryptionKey)) {
  throw new Error("ENCRYPTION_KEY is required and must be 64 hex characters, generate one with: openssl rand -hex 32");
}