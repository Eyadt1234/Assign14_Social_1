import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { limits, rateLimit } from "./middleware/rateLimit.js";
import adminRouter from "./modules/admin/admin.controller.js";
import authRouter from "./modules/auth/auth.controller.js";
import userRouter from "./modules/user/user.controller.js";

export const app = express();

app.set("trust proxy", env.trustProxy);
app.use(helmet());
app.use(cors({ origin: env.corsOrigins.length ? env.corsOrigins : false }));
app.use(rateLimit(limits.global));
app.use(express.json({ limit: "10kb" }));

//the saved images are public files
app.use(
  "/uploads",
  express.static(env.uploadsDir, {
    dotfiles: "deny",
    index: false,
    redirect: false,
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.get("/", (req, res) => {
  res.json({ message: "Social App is running" });
});

app.use("/auth", authRouter);
app.use("/users", userRouter);
app.use("/admin", adminRouter);

app.use(notFound);
app.use(errorHandler);