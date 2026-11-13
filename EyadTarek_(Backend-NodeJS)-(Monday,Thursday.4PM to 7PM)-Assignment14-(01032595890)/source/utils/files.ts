import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { env } from "../config/env.js";
import { AppError } from "./errors.js";

//svg is not allowed, it can carry scripts
export const imageTypes = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export const profileUrlPrefix = "/uploads/profile-pictures/";

const getProfileDir = (): string => resolve(env.uploadsDir, "profile-pictures");

//1: saveProfileImage
export const saveProfileImage = async (buffer: Buffer): Promise<string> => {
  const type = await fileTypeFromBuffer(buffer);
  const extension = type ? imageTypes.get(type.mime) : undefined;
  if (!extension) {
    throw new AppError("the file must be a jpeg, png or webp image", 400);
  }

  await mkdir(getProfileDir(), { recursive: true });
  const name = `${randomUUID()}.${extension}`;
  await writeFile(join(getProfileDir(), name), buffer, { flag: "wx" });
  return `${profileUrlPrefix}${name}`;
};

//_________________________________________________________________________________//

//2: removeProfileImage
export const removeProfileImage = async (value: string | undefined): Promise<void> => {
  if (!value || !value.startsWith(profileUrlPrefix)) {
    return;
  }
  const filePath = resolve(getProfileDir(), basename(value));
  if (dirname(filePath) === getProfileDir()) {
    await unlink(filePath).catch(() => undefined);
  }
};