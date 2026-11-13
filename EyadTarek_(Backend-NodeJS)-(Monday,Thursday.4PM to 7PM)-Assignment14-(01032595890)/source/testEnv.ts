import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMongoUri, checkRedisUri } from "./testGuard.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("the tests can not run with NODE_ENV=production");
}

process.env.MONGO_URI = process.env.TEST_MONGO_URI ?? "mongodb://127.0.0.1:27017/social_app_test";
process.env.REDIS_URI = process.env.TEST_REDIS_URI ?? "redis://127.0.0.1:6379/15";
process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "social-app-uploads-"));
process.env.CORS_ORIGINS = "https://frontend.example.com";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.SMTP_HOST = ""; //no real emails
process.env.GOOGLE_CLIENT_ID = "";
process.env.NODE_ENV = "test";
process.env.SOCIAL_APP_TEST_RUN = "1";

checkMongoUri(process.env.MONGO_URI);
checkRedisUri(process.env.REDIS_URI);