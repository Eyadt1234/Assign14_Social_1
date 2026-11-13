import mongoose from "mongoose";
import { connectDB } from "../DB/connection.js";
import { userRepository } from "../DB/repositories/index.js";

//makeAdmin
const makeAdmin = async (): Promise<void> => {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    throw new Error("usage: npm run make-admin -- user@example.com");
  }

  await connectDB();
  const done = await userRepository.setRole(email, "admin");
  console.log(done ? `${email} is an admin now` : `no confirmed active user with the email ${email}`);
  await mongoose.disconnect();
};

makeAdmin().catch((error: unknown) => {
  console.log(`failed: ${(error as Error).message}`);
  process.exit(1);
});