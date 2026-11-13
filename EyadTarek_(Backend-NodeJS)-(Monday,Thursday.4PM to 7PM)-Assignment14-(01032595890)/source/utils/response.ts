import type { Response } from "express";

export const successResponse = (res: Response, message: string, data: unknown = null, status: number = 200): void => {
  res.status(status).json({ message, data });
};