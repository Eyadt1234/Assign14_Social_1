import { env } from "../config/env.js";
import { getRedis, redis } from "../config/redis.js";
import { AppError } from "./errors.js";
import { compareOtp, hashOtp } from "./security.js";

export type OtpType = "confirm" | "reset";

export const otpKey = (type: OtpType, email: string): string => `otp:${type}:${email}`;
export const cooldownKey = (type: OtpType, email: string): string => `otp-cooldown:${type}:${email}`;

//_________________________________________________________________________________//

//1: run, a redis failure is always a 503
const run = async <T>(action: (client: typeof redis) => Promise<T>): Promise<T> => {
  const client = getRedis();
  try {
    return await action(client);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    console.log(`redis command failed: ${(error as Error).message}`);
    throw new AppError("service temporarily unavailable, please try again later", 503);
  }
};

//_________________________________________________________________________________//

//2: ensureOtpStore
export const ensureOtpStore = (): void => {
  getRedis();
};

//_________________________________________________________________________________//

//3: reserveOtpSlot
export const reserveOtpSlot = (type: OtpType, email: string): Promise<boolean> => {
  return run(async (client) => {
    const result = await client.set(cooldownKey(type, email), "1", { condition: "NX", expiration: { type: "EX", value: env.otpResendDelay } });
    return result === "OK";
  });
};

//_________________________________________________________________________________//

//4: releaseOtpSlot
export const releaseOtpSlot = async (type: OtpType, email: string): Promise<void> => {
  try {
    await getRedis().del(cooldownKey(type, email));
  } catch {
    //redis is down, the slot ends by itself
  }
};

//_________________________________________________________________________________//

//5: saveOtp
export const saveOtp = (type: OtpType, email: string, otp: string): Promise<void> => {
  return run(async (client) => {
    const key = otpKey(type, email);
    await client.multi().hSet(key, { code: hashOtp(otp), attempts: 0 }).expire(key, env.otpExpiresIn).exec();
  });
};

//_________________________________________________________________________________//

//6: checkOtp
export const checkOtp = (type: OtpType, email: string, otp: string): Promise<void> => {
  return run(async (client) => {
    const key = otpKey(type, email);
    const code = await client.hGet(key, "code");
    if (!code) {
      throw new AppError("invalid or expired code", 400);
    }

    const attempts = await client.hIncrBy(key, "attempts", 1);
    if (attempts > env.otpMaxAttempts) {
      throw new AppError("too many wrong tries, please request a new code", 429);
    }
    if (!compareOtp(otp, code) || (await client.del(key)) === 0) {
      throw new AppError("invalid or expired code", 400);
    }
  });
};