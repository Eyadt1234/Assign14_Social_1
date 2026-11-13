import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

//1: notFound
export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ message: `route ${req.method} ${req.originalUrl} not found` });
};

//_________________________________________________________________________________//

//2: getNumber
const getNumber = (error: unknown, key: string): number | undefined => {
  if (typeof error === "object" && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
};

//_________________________________________________________________________________//

//3: errorHandler
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (error instanceof AppError) {
    res.status(error.status).json({ message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    const errors = error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message }));
    res.status(400).json({ message: errors[0]?.message ?? "validation error", errors });
    return;
  }

  //multer errors
  if (error instanceof multer.MulterError) {
    const tooBig = error.code === "LIMIT_FILE_SIZE";
    res.status(tooBig ? 413 : 400).json({ message: tooBig ? `the image is too large (max ${Math.round(env.maxImageSize / 1024 / 1024)} MB)` : "invalid upload, send one image in the field named image" });
    return;
  }

  //duplicate key
  if (getNumber(error, "code") === 11000) {
    res.status(409).json({ message: "this value already exists" });
    return;
  }

  //errors of express itself
  const status = getNumber(error, "status");
  if (status && status >= 400 && status < 500 && error instanceof Error) {
    res.status(status).json({ message: status === 400 ? "invalid request body" : error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ message: "something went wrong" });
};