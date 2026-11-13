import type { redis } from "./config/redis.js";

type TestRedis = typeof redis;

export const sentinelKey = "social-app:test-database";

//the only keys the tests may delete
const ownedPatterns = ["otp:*", "otp-cooldown:*", "rate:*"];

//1: checkRedisUri
export const checkRedisUri = (uri: string): { port: string; db: number } => {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("the test redis uri is not valid");
  }
  if (url.protocol !== "redis:") {
    throw new Error("the test redis uri must start with redis:// (rediss:// is a remote server)");
  }
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`the test redis must be local, not ${url.hostname}`);
  }
  if (url.username || url.password) {
    throw new Error("the test redis must be a local throwaway instance without credentials");
  }
  const match = /^\/(\d{1,2})$/.exec(url.pathname);
  const db = match ? Number(match[1]) : 0;
  if (!match || db < 1 || db > 15) {
    throw new Error("the test redis uri must name a database from 1 to 15 (database 0 is never used)");
  }
  return { port: url.port || "6379", db };
};

//_________________________________________________________________________________//

//2: verifyTestRedis
export const verifyTestRedis = async (client: TestRedis, uri: string): Promise<void> => {
  if (process.env.SOCIAL_APP_TEST_RUN !== "1" || process.env.NODE_ENV !== "test") {
    throw new Error("redis cleanup is allowed only inside the test run");
  }
  const target = checkRedisUri(uri);

  const info = String(await client.sendCommand(["CLIENT", "INFO"]));
  const db = /\bdb=(\d+)/.exec(info)?.[1];
  const localAddress = /\bladdr=(\S+)/.exec(info)?.[1] ?? "";
  if (Number(db) !== target.db) {
    throw new Error("the connected redis database is not the one in the test uri");
  }
  if (!/^(127\.0\.0\.1|\[?::1\]?):/.test(localAddress)) {
    throw new Error("the connected redis server is not local");
  }

  //a database is used only if the tests marked it before
  if ((await client.get(sentinelKey)) !== "yes") {
    if ((await client.dbSize()) !== 0) {
      throw new Error("this redis database has data and is not marked as a test database, nothing was deleted");
    }
    await client.set(sentinelKey, "yes");
  }
};

//_________________________________________________________________________________//

//3: cleanTestRedis
export const cleanTestRedis = async (client: TestRedis, uri: string): Promise<void> => {
  await verifyTestRedis(client, uri);
  for (const pattern of ownedPatterns) {
    for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
      if (keys.length > 0) {
        await client.del(keys);
      }
    }
  }
};

//_________________________________________________________________________________//

const localMongoHosts = ["127.0.0.1", "localhost", "[::1]", "::1"];

//a test database name is letters, numbers
const isTestDatabaseName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]*_test$/.test(name);

//4: checkMongoUri
export const checkMongoUri = (uri: string): { db: string } => {
  if (/^mongodb\+srv:/i.test(uri)) {
    throw new Error("the test mongodb uri must not be mongodb+srv (that is a remote cluster)");
  }
  if (!/^mongodb:\/\//i.test(uri)) {
    throw new Error("the test mongodb uri must start with mongodb://");
  }
  const authority = uri.slice("mongodb://".length).split(/[/?]/)[0] ?? "";
  if (authority.includes("@")) {
    throw new Error("the test mongodb uri must not have a user or a password");
  }
  if (authority.includes(",")) {
    throw new Error("the test mongodb uri must have only one local host");
  }

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error("the test mongodb uri is not valid");
  }
  if (!localMongoHosts.includes(url.hostname)) {
    throw new Error(`the test mongodb must be local, not ${url.hostname}`);
  }
  if (url.searchParams.has("authSource") || url.searchParams.has("authMechanism")) {
    throw new Error("the test mongodb uri must not use authentication options");
  }

  let db = "";
  try {
    db = decodeURIComponent(url.pathname.slice(1));
  } catch {
    db = "";
  }
  if (!isTestDatabaseName(db)) {
    throw new Error(`the test mongodb database name must end with _test (for example social_app_test), not "${db}"`);
  }
  return { db };
};

//_________________________________________________________________________________//

//5: verifyTestMongo
export const verifyTestMongo = (name: string, host: string): void => {
  if (!isTestDatabaseName(name)) {
    throw new Error(`the connected mongodb database name must end with _test, not "${name}", nothing was dropped`);
  }
  if (!localMongoHosts.includes(host)) {
    throw new Error(`the connected mongodb server must be local, not ${host}, nothing was dropped`);
  }
};