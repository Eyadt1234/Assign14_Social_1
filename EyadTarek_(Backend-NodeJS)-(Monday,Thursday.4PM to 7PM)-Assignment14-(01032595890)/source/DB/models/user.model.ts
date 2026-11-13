import { model, Schema, type HydratedDocument } from "mongoose";

export type Gender = "male" | "female";
export type Provider = "system" | "google";
export type Role = "user" | "admin";

export interface IUser {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  phone?: string;
  bio?: string;
  gender?: Gender;
  dob?: Date;
  profilePicture?: string;
  provider: Provider;
  isConfirmed: boolean;
  isPrivate: boolean;
  role: Role;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

//_________________________________________________________________________________//

//the password is never selected by default, the queries must ask for it
const userSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true, trim: true, minlength: 2, maxlength: 30 },
    lastName: { type: String, default: "", trim: true, maxlength: 30 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    phone: { type: String, trim: true },
    bio: { type: String, trim: true, maxlength: 200 },
    gender: { type: String, enum: ["male", "female"] },
    dob: { type: Date },
    profilePicture: { type: String, trim: true },
    provider: { type: String, enum: ["system", "google"], default: "system" },
    isConfirmed: { type: Boolean, default: false },
    isPrivate: { type: Boolean, default: false },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.index({ firstName: 1, lastName: 1 });

export const User = model<IUser>("User", userSchema);