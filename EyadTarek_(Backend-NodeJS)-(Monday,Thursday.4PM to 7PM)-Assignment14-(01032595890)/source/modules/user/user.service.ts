import { Types } from "mongoose";
import type { UserDocument } from "../../DB/models/user.model.js";
import { followRepository, sessionRepository, userRepository } from "../../DB/repositories/index.js";
import { toLimitedDto, toOwnDto, toPublicDto, type LimitedUserDto, type OwnUserDto, type PublicUserDto } from "../../utils/dto.js";
import { encrypt } from "../../utils/encryption.js";
import { AppError } from "../../utils/errors.js";
import { removeProfileImage, saveProfileImage } from "../../utils/files.js";
import { getPageMeta, getSkip, type PageMeta, type PaginationDto } from "../../utils/pagination.js";
import { comparePassword, hashPassword } from "../../utils/security.js";
import type { ChangePasswordDto, SearchDto, UpdateProfileDto } from "./user.validation.js";

export type FollowState = "none" | "pending" | "following";

export interface FollowCounts {
  followersCount: number;
  followingCount: number;
}

export interface ProfileView extends FollowCounts {
  profile: OwnUserDto | PublicUserDto | LimitedUserDto;
  followStatus: FollowState | "self";
  canViewProfile: boolean;
}

export interface UserList extends PageMeta {
  users: LimitedUserDto[];
}

//_________________________________________________________________________________//

//1: findActiveUser
const findActiveUser = async (id: string): Promise<UserDocument> => {
  const user = await userRepository.findActiveById(id);
  if (!user) {
    throw new AppError("user not found", 404);
  }
  return user;
};

//_________________________________________________________________________________//

//2: getFollowState
const getFollowState = async (viewerId: string, targetId: string): Promise<FollowState> => {
  const status = await followRepository.findStatus(viewerId, targetId);
  if (!status) {
    return "none";
  }
  return status === "accepted" ? "following" : "pending";
};

//_________________________________________________________________________________//

//3: getCounts
const getCounts = async (userId: string): Promise<FollowCounts> => {
  const [followersCount, followingCount] = await Promise.all([followRepository.countFollowers(userId), followRepository.countFollowing(userId)]);
  return { followersCount, followingCount };
};

//_________________________________________________________________________________//

//4: canViewProfile
const canViewProfile = async (viewerId: string, target: UserDocument): Promise<boolean> => {
  if (viewerId === target._id.toString() || !target.isPrivate) {
    return true;
  }
  return (await getFollowState(viewerId, target._id.toString())) === "following";
};

//_________________________________________________________________________________//

//5: toUserList
const toUserList = async (ids: Types.ObjectId[], query: PaginationDto, total: number): Promise<UserList> => {
  const users = await userRepository.findActiveByIds(ids);
  return { users: users.map(toLimitedDto), ...getPageMeta(query, total) };
};

//_________________________________________________________________________________//

//6: getMyProfile
export const getMyProfile = async (user: UserDocument): Promise<ProfileView> => {
  return {
    profile: toOwnDto(user),
    ...(await getCounts(user._id.toString())),
    followStatus: "self",
    canViewProfile: true,
  };
};

//_________________________________________________________________________________//

//7: getProfile
export const getProfile = async (viewer: UserDocument, targetId: string): Promise<ProfileView> => {
  const viewerId = viewer._id.toString();
  if (viewerId === targetId) {
    return getMyProfile(viewer);
  }

  const target = await findActiveUser(targetId);
  const canView = await canViewProfile(viewerId, target);
  return {
    profile: canView ? toPublicDto(target) : toLimitedDto(target),
    ...(await getCounts(targetId)),
    followStatus: await getFollowState(viewerId, targetId),
    canViewProfile: canView,
  };
};

//_________________________________________________________________________________//

//8: updateProfile
export const updateProfile = async (userId: string, data: UpdateProfileDto): Promise<OwnUserDto> => {
  const { phone, ...rest } = data;
  const user = await userRepository.updateProfile(userId, { ...rest, ...(phone ? { phone: encrypt(phone) } : {}) });
  if (!user) {
    throw new AppError("user not found", 404);
  }
  return toOwnDto(user);
};

//_________________________________________________________________________________//

//9: updateProfilePicture
export const updateProfilePicture = async (user: UserDocument, file: Express.Multer.File | undefined): Promise<OwnUserDto> => {
  if (!file) {
    throw new AppError("the image is required, send it in the field named image", 400);
  }
  const path = await saveProfileImage(file.buffer);
  const updated = await userRepository.setProfilePicture(user._id, path);
  if (!updated) {
    await removeProfileImage(path);
    throw new AppError("user not found", 404);
  }
  await removeProfileImage(user.profilePicture);
  return toOwnDto(updated);
};

//_________________________________________________________________________________//

//10: removeProfilePicture
export const removeProfilePicture = async (user: UserDocument): Promise<OwnUserDto> => {
  const updated = await userRepository.setProfilePicture(user._id, null);
  if (!updated) {
    throw new AppError("user not found", 404);
  }
  await removeProfileImage(user.profilePicture);
  return toOwnDto(updated);
};

//_________________________________________________________________________________//

//11: changePassword
export const changePassword = async (userId: string, sessionId: string, data: ChangePasswordDto): Promise<void> => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) {
    throw new AppError("user not found", 404);
  }
  if (!user.password) {
    throw new AppError("this account has no password, use forgot password to set one", 400);
  }
  if (!(await comparePassword(data.oldPassword, user.password))) {
    throw new AppError("the old password is wrong", 400);
  }
  if (await comparePassword(data.newPassword, user.password)) {
    throw new AppError("the new password must be different from the old one", 400);
  }

  await userRepository.setPassword(userId, await hashPassword(data.newPassword));
  await sessionRepository.deleteAllOfUser(userId, sessionId);
};

//_________________________________________________________________________________//

//12: deleteAccount
export const deleteAccount = async (userId: string, password: string | undefined): Promise<void> => {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) {
    throw new AppError("user not found", 404);
  }
  if (user.password && (!password || !(await comparePassword(password, user.password)))) {
    throw new AppError("the password is wrong", 400);
  }

  await userRepository.softDelete(userId);
  await sessionRepository.deleteAllOfUser(userId);
  await followRepository.suspendFor(userId);
};

//_________________________________________________________________________________//

//13: getSettings
export const getSettings = (user: UserDocument): { isPrivate: boolean } => {
  return { isPrivate: user.isPrivate };
};

//_________________________________________________________________________________//

//14: updateSettings
export const updateSettings = async (userId: string, isPrivate: boolean): Promise<{ isPrivate: boolean }> => {
  await userRepository.setPrivacy(userId, isPrivate);
  if (!isPrivate) {
    await followRepository.acceptAllPending(userId);
  }
  return { isPrivate };
};

//_________________________________________________________________________________//

//15: follow
export const follow = async (userId: string, targetId: string): Promise<{ status: "accepted" | "pending" }> => {
  if (userId === targetId) {
    throw new AppError("you can't follow yourself", 400);
  }
  const target = await findActiveUser(targetId);

  const state = await getFollowState(userId, targetId);
  if (state !== "none") {
    throw new AppError(state === "pending" ? "the follow request is already sent" : "you already follow this user", 409);
  }

  const status = target.isPrivate ? "pending" : "accepted";
  await followRepository.create(userId, targetId, status);
  return { status };
};

//_________________________________________________________________________________//

//16: unfollow
export const unfollow = async (userId: string, targetId: string): Promise<void> => {
  if (!(await followRepository.delete(userId, targetId))) {
    throw new AppError("you don't follow this user", 404);
  }
};

//_________________________________________________________________________________//

//17: getFollowRequests
export const getFollowRequests = async (userId: string, query: PaginationDto): Promise<UserList> => {
  const { ids, total } = await followRepository.listRequests(userId, getSkip(query), query.limit);
  return toUserList(ids, query, total);
};

//_________________________________________________________________________________//

//18: respondToFollowRequest
export const respondToFollowRequest = async (userId: string, followerId: string, action: "accept" | "reject"): Promise<void> => {
  if (!(await followRepository.respondToRequest(followerId, userId, action))) {
    throw new AppError("follow request not found", 404);
  }
};

//_________________________________________________________________________________//

//19: getFollowList
export const getFollowList = async (viewer: UserDocument, targetId: string, type: "followers" | "following", query: PaginationDto): Promise<UserList> => {
  const target = await findActiveUser(targetId);
  if (!(await canViewProfile(viewer._id.toString(), target))) {
    throw new AppError("this account is private, follow it to see this list", 403);
  }

  const page = type === "followers" ? await followRepository.listFollowers(targetId, getSkip(query), query.limit) : await followRepository.listFollowing(targetId, getSkip(query), query.limit);
  return toUserList(page.ids, query, page.total);
};

//_________________________________________________________________________________//

//20: escapeRegex
const escapeRegex = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

//_________________________________________________________________________________//

//21: searchUsers
export const searchUsers = async (userId: string, query: SearchDto): Promise<UserList> => {
  const words = query.q.split(/\s+/).map((word) => new RegExp(escapeRegex(word), "i"));
  const { users, total } = await userRepository.searchActive(userId, words, getSkip(query), query.limit);
  return { users: users.map(toLimitedDto), ...getPageMeta(query, total) };
};

//_________________________________________________________________________________//

//22: getSuggestions
export const getSuggestions = async (userId: string, query: PaginationDto): Promise<UserList> => {
  const { all, accepted } = await followRepository.getFollowedIds(userId);
  const excluded = [...all, new Types.ObjectId(userId)];
  const mutualIds = await followRepository.findMutualCandidates(accepted, excluded, 200);

  const offset = getSkip(query);
  const mutualPage = mutualIds.slice(offset, offset + query.limit);
  const missing = query.limit - mutualPage.length;
  const others = await userRepository.findNewestActive([...excluded, ...mutualIds], missing > 0 ? Math.max(offset - mutualIds.length, 0) : 0, Math.max(missing, 0));

  const mutualUsers = await userRepository.findActiveByIds(mutualPage);
  const users = [...mutualUsers, ...(missing > 0 ? others.users : [])].map(toLimitedDto);
  return { users, ...getPageMeta(query, mutualIds.length + others.total) };
};