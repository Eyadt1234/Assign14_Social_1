import type { NextFunction, Request, Response } from "express";
import type { Role } from "../DB/models/user.model.js";
import { AppError } from "../utils/errors.js";
import { getAuth } from "./authentication.js";

//1: authorization
export const authorization = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { user } = getAuth(req);
    if (!roles.includes(user.role)) {
      throw new AppError("you are not allowed to do this", 403);
    }
    next();
  };
};