import bcrypt from "bcryptjs";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

//1: hashPassword
export const hashPassword = (password: string): Promise<string> => {
  return bcrypt.hash(password, env.saltRounds);
};

//_________________________________________________________________________________//

//2: comparePassword
export const comparePassword = (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

//_________________________________________________________________________________//

//3: generateOtp
export const generateOtp = (): string => {
  return randomInt(0, 1000000).toString().padStart(6, "0");
};

//_________________________________________________________________________________//

//4: hashOtp
export const hashOtp = (otp: string): string => {
  return createHmac("sha256", env.accessSecret).update(otp).digest("hex");
};

//_________________________________________________________________________________//

//5: compareOtp
export const compareOtp = (otp: string, hash: string): boolean => {
  const first = Buffer.from(hashOtp(otp));
  const second = Buffer.from(hash);
  return first.length === second.length && timingSafeEqual(first, second);
};