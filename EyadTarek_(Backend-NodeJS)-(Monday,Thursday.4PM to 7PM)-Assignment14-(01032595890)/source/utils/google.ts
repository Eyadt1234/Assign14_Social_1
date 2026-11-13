import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

export interface GoogleProfile {
  email: string;
  firstName: string;
  lastName: string;
  picture: string | null;
}

const client = new OAuth2Client(env.googleClientId);

//googleAuth
export const googleAuth = {
  //1: verify
  verify: async (idToken: string): Promise<GoogleProfile> => {
    if (!env.googleClientId) {
      throw new AppError("google sign-in is not configured", 501);
    }
    try {
      const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
      const payload = ticket.getPayload();
      if (!payload || !payload.email || !payload.email_verified) {
        throw new Error("email is not verified");
      }
      return {
        email: payload.email.toLowerCase(),
        firstName: payload.given_name ?? payload.name ?? "User",
        lastName: payload.family_name ?? "",
        picture: payload.picture ?? null,
      };
    } catch {
      throw new AppError("invalid google token", 401);
    }
  },
};