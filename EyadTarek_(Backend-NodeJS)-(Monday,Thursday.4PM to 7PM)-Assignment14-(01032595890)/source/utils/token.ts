import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export interface AccessPayload {
  id: string;
  sid: string;
}

export interface RefreshPayload extends AccessPayload {
  jti: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

//_________________________________________________________________________________//

//1: signAccessToken
export const signAccessToken = (payload: AccessPayload): string => {
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessExpiresIn });
};

//_________________________________________________________________________________//

//2: signRefreshToken
export const signRefreshToken = (payload: RefreshPayload): string => {
  return jwt.sign(payload, env.refreshSecret, { expiresIn: env.refreshExpiresIn });
};

//_________________________________________________________________________________//

//3: readToken
const readToken = (token: string, secret: string): Record<string, unknown> => {
  try {
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === "string") {
      throw new Error("wrong payload");
    }
    return { ...decoded };
  } catch {
    throw new AppError("invalid or expired token", 401);
  }
};

//_________________________________________________________________________________//

//4: verifyAccessToken
export const verifyAccessToken = (token: string): AccessPayload => {
  const { id, sid } = readToken(token, env.accessSecret);
  if (typeof id !== "string" || typeof sid !== "string") {
    throw new AppError("invalid or expired token", 401);
  }
  return { id, sid };
};

//_________________________________________________________________________________//

//5: verifyRefreshToken
export const verifyRefreshToken = (token: string): RefreshPayload => {
  const { id, sid, jti } = readToken(token, env.refreshSecret);
  if (typeof id !== "string" || typeof sid !== "string" || typeof jti !== "string") {
    throw new AppError("invalid or expired token", 401);
  }
  return { id, sid, jti };
};