import type { Types } from "mongoose";
import { User, type IUser, type Provider, type Role, type UserDocument } from "../models/user.model.js";

type Id = string | Types.ObjectId;

export type NewUser = Pick<IUser, "firstName" | "lastName" | "email"> & Partial<Pick<IUser, "password" | "phone" | "gender" | "provider" | "isConfirmed" | "profilePicture">>;

//no undefined values at runtime
export type ProfileChanges = { [Key in "firstName" | "lastName" | "phone" | "bio" | "gender" | "dob"]?: IUser[Key] | undefined };

//confirmed and not deleted
const active = { isConfirmed: true, deletedAt: null } as const;

export class UserRepository {
  //1: create
  public create(data: NewUser): Promise<UserDocument> {
    return User.create(data);
  }

  //_________________________________________________________________________________//

  //2: findById
  public findById(id: Id): Promise<UserDocument | null> {
    return User.findById(id);
  }

  //_________________________________________________________________________________//

  //3: findActiveById
  public findActiveById(id: Id): Promise<UserDocument | null> {
    return User.findOne({ _id: id, ...active });
  }

  //_________________________________________________________________________________//

  //4: findByEmail
  public findByEmail(email: string): Promise<UserDocument | null> {
    return User.findOne({ email });
  }

  //_________________________________________________________________________________//

  //5: findByEmailWithPassword
  public findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return User.findOne({ email }).select("+password");
  }

  //_________________________________________________________________________________//

  //6: findByIdWithPassword
  public findByIdWithPassword(id: Id): Promise<UserDocument | null> {
    return User.findById(id).select("+password");
  }

  //_________________________________________________________________________________//

  //7: findUnconfirmedByEmail
  public findUnconfirmedByEmail(email: string): Promise<UserDocument | null> {
    return User.findOne({ email, isConfirmed: false });
  }

  //_________________________________________________________________________________//

  //8: findActiveByEmail
  public findActiveByEmail(email: string): Promise<UserDocument | null> {
    return User.findOne({ email, ...active });
  }

  //_________________________________________________________________________________//

  //9: emailExists
  public async emailExists(email: string): Promise<boolean> {
    return (await User.exists({ email })) !== null;
  }

  //_________________________________________________________________________________//

  //10: findActiveByIds
  public async findActiveByIds(ids: Id[]): Promise<UserDocument[]> {
    const users = await User.find({ _id: { $in: ids }, ...active });
    const byId = new Map(users.map((user) => [user._id.toString(), user]));
    const result: UserDocument[] = [];
    for (const id of ids) {
      const user = byId.get(id.toString());
      if (user) {
        result.push(user);
      }
    }
    return result;
  }

  //_________________________________________________________________________________//

  //11: searchActive
  public async searchActive(excludeId: Id, words: RegExp[], skip: number, limit: number): Promise<{ users: UserDocument[]; total: number }> {
    const filter = {
      _id: { $ne: excludeId },
      ...active,
      $and: words.map((word) => ({ $or: [{ firstName: word }, { lastName: word }] })),
    };
    const [users, total] = await Promise.all([
      User.find(filter).sort({ firstName: 1, lastName: 1, _id: 1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return { users, total };
  }

  //_________________________________________________________________________________//

  //12: findNewestActive
  public async findNewestActive(excluded: Id[], skip: number, limit: number): Promise<{ users: UserDocument[]; total: number }> {
    const filter = { _id: { $nin: excluded }, ...active };
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return { users, total };
  }

  //_________________________________________________________________________________//

  //13: findDeletedIds
  public async findDeletedIds(ids: Id[]): Promise<string[]> {
    const users = await User.find({ _id: { $in: ids }, deletedAt: { $ne: null } }).select("_id");
    return users.map((user) => user._id.toString());
  }

  //_________________________________________________________________________________//

  //14: listForAdmin
  public async listForAdmin(status: "all" | "active" | "deleted", skip: number, limit: number): Promise<{ users: UserDocument[]; total: number }> {
    const filter = status === "all" ? {} : status === "deleted" ? { deletedAt: { $ne: null } } : { deletedAt: null };
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);
    return { users, total };
  }

  //_________________________________________________________________________________//

  //15: updateProfile
  public updateProfile(id: Id, changes: ProfileChanges): Promise<UserDocument | null> {
    return User.findOneAndUpdate({ _id: id, ...active }, { $set: changes }, { returnDocument: "after", runValidators: true });
  }

  //_________________________________________________________________________________//

  //16: setProfilePicture
  public setProfilePicture(id: Id, path: string | null): Promise<UserDocument | null> {
    const update = path ? { $set: { profilePicture: path } } : { $unset: { profilePicture: "" } };
    return User.findOneAndUpdate({ _id: id, ...active }, update, { returnDocument: "after" });
  }

  //_________________________________________________________________________________//

  //17: setPassword
  public async setPassword(id: Id, hash: string): Promise<void> {
    await User.updateOne({ _id: id }, { $set: { password: hash } });
  }

  //_________________________________________________________________________________//

  //18: setConfirmed
  public async setConfirmed(id: Id): Promise<void> {
    await User.updateOne({ _id: id }, { $set: { isConfirmed: true } });
  }

  //_________________________________________________________________________________//

  //19: convertToGoogle
  public async convertToGoogle(id: Id): Promise<void> {
    await User.updateOne({ _id: id }, { $set: { provider: "google" satisfies Provider, isConfirmed: true }, $unset: { password: "" } });
  }

  //_________________________________________________________________________________//

  //20: setPrivacy
  public async setPrivacy(id: Id, isPrivate: boolean): Promise<void> {
    await User.updateOne({ _id: id }, { $set: { isPrivate } });
  }

  //_________________________________________________________________________________//

  //21: softDelete
  public async softDelete(id: Id): Promise<boolean> {
    const result = await User.updateOne({ _id: id, deletedAt: null }, { $set: { deletedAt: new Date() } });
    return result.modifiedCount > 0;
  }

  //_________________________________________________________________________________//

  //22: restore
  public async restore(id: Id): Promise<boolean> {
    const result = await User.updateOne({ _id: id, deletedAt: { $ne: null } }, { $unset: { deletedAt: "" } });
    return result.modifiedCount > 0;
  }

  //_________________________________________________________________________________//

  //23: setRole
  public async setRole(email: string, role: Role): Promise<boolean> {
    const result = await User.updateOne({ email, isConfirmed: true, deletedAt: null }, { $set: { role } });
    return result.matchedCount > 0;
  }
}

export const userRepository = new UserRepository();