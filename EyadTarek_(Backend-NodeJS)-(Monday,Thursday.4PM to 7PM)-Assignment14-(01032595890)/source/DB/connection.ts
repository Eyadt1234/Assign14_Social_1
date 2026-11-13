import mongoose from "mongoose";
import { env } from "../config/env.js";

//connectDB
export const connectDB = async (uri: string = env.mongoUri): Promise<void> => {
  await mongoose.connect(uri);
  console.log("database connected");
};