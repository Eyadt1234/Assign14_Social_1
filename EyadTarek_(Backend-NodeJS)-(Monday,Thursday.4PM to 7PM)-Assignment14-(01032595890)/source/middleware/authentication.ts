import type { NextFunction, Request, Response } from "express";
import type { UserDocument } from "../DB/models/user.model.js";
import { sessionRepository, userRepository } from "../DB/repositories/index.js";
import { AppError } from "../utils/errors.js";
import { verifyAccessToken } from "../utils/token.js";

//authentication
declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
      sessionId?: string;
    }
  }
}

//_________________________________________________________________________________//

//1: authentication
export const authentication = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("authorization token is required", 401);
  }

  const payload = verifyAccessToken(header.slice(7));
  const session = await sessionRepository.findValid(payload.sid, payload.id);
  if (!session) {
    throw new AppError("session expired or revoked, please login again", 401);
  }

  const user = await userRepository.findById(payload.id);
  if (!user || !user.isConfirmed || user.deletedAt) {
    throw new AppError("user not found", 401);
  }

  req.user = user;
  req.sessionId = payload.sid;
  next();
};

//_________________________________________________________________________________//

//2: getAuth
export const getAuth = (req: Request): { user: UserDocument; userId: string; sessionId: string } => {
  if (!req.user || !req.sessionId) {
    throw new AppError("authorization token is required", 401);
  }
  return { user: req.user, userId: req.user._id.toString(), sessionId: req.sessionId };
};