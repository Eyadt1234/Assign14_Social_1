import { model, Schema, type Types } from "mongoose";

//one session = one login
export interface ISession {
  userId: Types.ObjectId;
  refreshJti: string;
  expiresAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshJti: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model<ISession>("Session", sessionSchema);