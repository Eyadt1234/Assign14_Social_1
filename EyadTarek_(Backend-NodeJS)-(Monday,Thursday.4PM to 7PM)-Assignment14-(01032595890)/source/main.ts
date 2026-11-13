import mongoose from "mongoose";
import { app } from "./app.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { env } from "./config/env.js";
import { connectDB } from "./DB/connection.js";

//bootstrap
const bootstrap = async (): Promise<void> => {
  await connectDB();
  const server = app.listen(env.port, () => {
    console.log(`server is running on port ${env.port}`);
  });
  void connectRedis();

  const shutdown = async (): Promise<void> => {
    server.close();
    await disconnectRedis();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
};

bootstrap().catch((error: unknown) => {
  console.log(`failed to start: ${(error as Error).message}`);
  process.exit(1);
});