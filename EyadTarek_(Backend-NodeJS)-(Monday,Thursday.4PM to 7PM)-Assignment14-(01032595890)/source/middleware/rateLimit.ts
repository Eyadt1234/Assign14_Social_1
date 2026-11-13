import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { redis } from "../config/redis.js";
import { AppError } from "../utils/errors.js";

export interface RateLimitOptions {
  name: string;
  max: number;
  windowSeconds: number;
  byEmail?: boolean;
}

//byEmail = the limit is per ip + email
export const limits = {
  global: { name: "global", max: 300, windowSeconds: 60 },
  register: { name: "register", max: 10, windowSeconds: 3600 },
  login: { name: "login", max: 10, windowSeconds: 900, byEmail: true },
  confirmEmail: { name: "confirm-email", max: 10, windowSeconds: 900, byEmail: true },
  resendOtp: { name: "resend-otp", max: 5, windowSeconds: 900, byEmail: true },
  forgotPassword: { name: "forgot-password", max: 5, windowSeconds: 900, byEmail: true },
  resetPassword: { name: "reset-password", max: 10, windowSeconds: 900, byEmail: true },
  google: { name: "google", max: 20, windowSeconds: 900 },
} satisfies Record<string, RateLimitOptions>;

//used when redis is down
const memoryHits = new Map<string, { count: number; resetAt: number }>();

//_________________________________________________________________________________//

//1: hitRedis
const hitRedis = async (key: string, windowSeconds: number): Promise<{ count: number; retryAfter: number }> => {
  const [count, , ttl] = await redis.multi().incr(key).expire(key, windowSeconds, "NX").ttl(key).exec();
  return { count: Number(count), retryAfter: Math.max(Number(ttl), 1) };
};

//_________________________________________________________________________________//

//2: hitMemory
const hitMemory = (key: string, windowSeconds: number): { count: number; retryAfter: number } => {
  const now = Date.now();
  if (memoryHits.size > 10000) {
    for (const [oldKey, entry] of memoryHits) {
      if (entry.resetAt <= now) {
        memoryHits.delete(oldKey);
      }
    }
  }
  const entry = memoryHits.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { count: 1, retryAfter: windowSeconds };
  }
  entry.count++;
  return { count: entry.count, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
};

//_________________________________________________________________________________//

//3: getEmail
const getEmail = (req: Request): string => {
  const body: unknown = req.body;
  if (typeof body === "object" && body !== null && "email" in body && typeof body.email === "string") {
    return body.email.trim().toLowerCase();
  }
  return "";
};

//_________________________________________________________________________________//

//4: rateLimit
export const rateLimit = (options: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!env.rateLimitEnabled) {
      next();
      return;
    }

    const key = `rate:${options.name}:${req.ip ?? "unknown"}${options.byEmail ? `:${getEmail(req)}` : ""}`;
    let result: { count: number; retryAfter: number };
    try {
      result = redis.isReady ? await hitRedis(key, options.windowSeconds) : hitMemory(key, options.windowSeconds);
    } catch {
      result = hitMemory(key, options.windowSeconds);
    }

    if (result.count > options.max) {
      res.setHeader("Retry-After", result.retryAfter);
      throw new AppError("too many requests, please try again later", 429);
    }
    next();
  };
};