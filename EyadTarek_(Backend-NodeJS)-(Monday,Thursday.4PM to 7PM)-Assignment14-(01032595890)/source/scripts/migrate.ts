import mongoose from "mongoose";
import { connectDB } from "../DB/connection.js";
import { migrate } from "../DB/migration.js";

const run = async (): Promise<void> => {
  await connectDB();
  const result = await migrate();
  console.log(`phones encrypted: ${result.phones}`);
  console.log(`roles added: ${result.roles}`);
  await mongoose.disconnect();
};

run().catch((error: unknown) => {
  console.log(`migration failed: ${(error as Error).message}`);
  process.exit(1);
});
