import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const prefix = "enc:v1:";

//1: encrypt
export const encrypt = (text: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(env.encryptionKey, "hex"), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${data.toString("hex")}`;
};

//_________________________________________________________________________________//

//2: isEncrypted
export const isEncrypted = (value: string): boolean => {
  return value.startsWith(prefix);
};

//_________________________________________________________________________________//

//3: decrypt
export const decrypt = (value: string): string => {
  const [iv, tag, data] = value.slice(prefix.length).split(":");
  if (!isEncrypted(value) || !iv || !tag || !data) {
    throw new Error("the value is not encrypted");
  }
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(env.encryptionKey, "hex"), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
};

//_________________________________________________________________________________//

//4: readPhone
export const readPhone = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  if (!isEncrypted(value)) {
    return value;
  }
  try {
    return decrypt(value);
  } catch {
    return null;
  }
};