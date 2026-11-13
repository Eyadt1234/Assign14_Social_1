import { Types } from "mongoose";
import { Follow, type FollowStatus } from "../models/follow.model.js";

type Id = string | Types.ObjectId;

//suspended = one of the users is deleted
const visible = { suspended: { $ne: true } } as const;

export interface FollowedIds {
  all: Types.ObjectId[];
  accepted: Types.ObjectId[];
}

export interface IdPage {
  ids: Types.ObjectId[];
  total: number;
}

export class FollowRepository {
  //1: findStatus
  public async findStatus(followerId: Id, followingId: Id): Promise<FollowStatus | null> {
    const follow = await Follow.findOne({ follower: followerId, following: followingId, ...visible });
    return follow ? follow.status : null;
  }

  //_________________________________________________________________________________//

  //2: create
  public async create(followerId: Id, followingId: Id, status: FollowStatus): Promise<void> {
    await Follow.create({ follower: followerId, following: followingId, status });
  }

  //_________________________________________________________________________________//

  //3: delete
  public async delete(followerId: Id, followingId: Id): Promise<boolean> {
    const result = await Follow.deleteOne({ follower: followerId, following: followingId, ...visible });
    return result.deletedCount > 0;
  }

  //_________________________________________________________________________________//

  //4: countFollowers
  public countFollowers(userId: Id): Promise<number> {
    return Follow.countDocuments({ following: userId, status: "accepted", ...visible });
  }

  //_________________________________________________________________________________//

  //5: countFollowing
  public countFollowing(userId: Id): Promise<number> {
    return Follow.countDocuments({ follower: userId, status: "accepted", ...visible });
  }

  //_________________________________________________________________________________//

  //6: listFollowers
  public async listFollowers(userId: Id, skip: number, limit: number): Promise<IdPage> {
    const filter = { following: userId, status: "accepted", ...visible } as const;
    const [follows, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Follow.countDocuments(filter),
    ]);
    return { ids: follows.map((follow) => follow.follower), total };
  }

  //_________________________________________________________________________________//

  //7: listFollowing
  public async listFollowing(userId: Id, skip: number, limit: number): Promise<IdPage> {
    const filter = { follower: userId, status: "accepted", ...visible } as const;
    const [follows, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Follow.countDocuments(filter),
    ]);
    return { ids: follows.map((follow) => follow.following), total };
  }

  //_________________________________________________________________________________//

  //8: listRequests
  public async listRequests(userId: Id, skip: number, limit: number): Promise<IdPage> {
    const filter = { following: userId, status: "pending", ...visible } as const;
    const [follows, total] = await Promise.all([
      Follow.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Follow.countDocuments(filter),
    ]);
    return { ids: follows.map((follow) => follow.follower), total };
  }

  //_________________________________________________________________________________//

  //9: respondToRequest
  public async respondToRequest(followerId: Id, userId: Id, action: "accept" | "reject"): Promise<boolean> {
    const filter = { follower: followerId, following: userId, status: "pending", ...visible } as const;
    if (action === "accept") {
      return (await Follow.updateOne(filter, { $set: { status: "accepted" } })).modifiedCount > 0;
    }
    return (await Follow.deleteOne(filter)).deletedCount > 0;
  }

  //_________________________________________________________________________________//

  //10: acceptAllPending
  public async acceptAllPending(userId: Id): Promise<void> {
    await Follow.updateMany({ following: userId, status: "pending" }, { $set: { status: "accepted" } });
  }

  //_________________________________________________________________________________//

  //11: getFollowedIds
  public async getFollowedIds(userId: Id): Promise<FollowedIds> {
    const follows = await Follow.find({ follower: userId, ...visible }).select("following status");
    return {
      all: follows.map((follow) => follow.following),
      accepted: follows.filter((follow) => follow.status === "accepted").map((follow) => follow.following),
    };
  }

  //_________________________________________________________________________________//

  //12: findMutualCandidates
  public async findMutualCandidates(followedIds: Types.ObjectId[], excluded: Types.ObjectId[], limit: number): Promise<Types.ObjectId[]> {
    const rows = await Follow.aggregate<{ _id: Types.ObjectId }>([
      { $match: { follower: { $in: followedIds }, status: "accepted", suspended: { $ne: true }, following: { $nin: excluded } } },
      { $group: { _id: "$following", mutualCount: { $sum: 1 } } },
      { $sort: { mutualCount: -1, _id: 1 } },
      { $limit: limit },
    ]);
    return rows.map((row) => row._id);
  }

  //_________________________________________________________________________________//

  //13: suspendFor
  public async suspendFor(userId: Id): Promise<void> {
    await Follow.updateMany({ $or: [{ follower: userId }, { following: userId }] }, { $set: { suspended: true } });
  }

  //_________________________________________________________________________________//

  //14: resumeFor
  public async resumeFor(userId: Id, isDeleted: (otherIds: Types.ObjectId[]) => Promise<string[]>): Promise<void> {
    const follows = await Follow.find({ $or: [{ follower: userId }, { following: userId }], suspended: true });
    const others = follows.map((follow) => (follow.follower.equals(userId) ? follow.following : follow.follower));
    const deleted = new Set(await isDeleted(others));
    const resumeIds = follows.filter((follow, index) => !deleted.has(String(others[index]))).map((follow) => follow._id);
    await Follow.updateMany({ _id: { $in: resumeIds } }, { $set: { suspended: false } });
  }
}

export const followRepository = new FollowRepository();