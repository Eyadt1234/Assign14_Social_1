import { createClient } from "redis";
import { env } from "./env.js";
import { AppError } from "../utils/errors.js";

export const redis = createClient({
  url: env.redisUri,
  disableOfflineQueue: true,
  socket: { reconnectStrategy: (retries: number) => Math.min(retries * 200, 3000) },
});

let lastLog = 0;
let connecting: Promise<void> | null = null;

redis.on("ready", () => {
  console.log("redis ready");
});

redis.on("error", (error: Error) => {
  if (Date.now() - lastLog > 10000) {
    lastLog = Date.now();
    console.log(`redis error: ${error.message}`);
  }
});

//_________________________________________________________________________________//

//1: connectRedis
export const connectRedis = (): Promise<void> => {
  if (!connecting) {
    connecting = redis
      .connect()
      .then(() => undefined)
      .catch((error: Error) => {
        console.log(`redis connect failed: ${error.message}`);
        connecting = null;
      });
  }
  return connecting;
};

//_________________________________________________________________________________//

//2: disconnectRedis
export const disconnectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    if (redis.isReady) {
      await redis.close();
    } else {
      redis.destroy();
    }
  }
  connecting = null;
};

//_________________________________________________________________________________//

//3: getRedis
export const getRedis = (): typeof redis => {
  if (!redis.isReady) {
    throw new AppError("service temporarily unavailable, please try again later", 503);
  }
  return redis;
};