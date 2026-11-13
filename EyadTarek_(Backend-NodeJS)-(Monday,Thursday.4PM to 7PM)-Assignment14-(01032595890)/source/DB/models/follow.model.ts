import { model, Schema, type Types } from "mongoose";

//pending
//suspended
export type FollowStatus = "pending" | "accepted";

export interface IFollow {
  follower: Types.ObjectId;
  following: Types.ObjectId;
  status: FollowStatus;
  suspended?: boolean;
}

const followSchema = new Schema<IFollow>(
  {
    follower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    following: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted"], required: true },
    suspended: { type: Boolean, default: false },
  },
  { timestamps: true }
);

//the same user can't follow the same user twice
followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1, status: 1 });

export const Follow = model<IFollow>("Follow", followSchema);