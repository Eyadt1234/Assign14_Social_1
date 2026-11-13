import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { imageTypes } from "../utils/files.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxImageSize, files: 1, fields: 0 },
  fileFilter: (req, file, callback) => {
    if (!imageTypes.has(file.mimetype)) {
      callback(new AppError("only jpeg, png and webp images are allowed", 400));
      return;
    }
    callback(null, true);
  },
});

//1: uploadProfilePicture
export const uploadProfilePicture = upload.single("image");
