import type { Gender, Provider, Role, UserDocument } from "../DB/models/user.model.js";
import { readPhone } from "./encryption.js";

//what the other users can see when the profile is private
export interface LimitedUserDto {
  id: string;
  firstName: string;
  lastName: string;
  profilePicture: string | null;
  isPrivate: boolean;
}

//what the other users can see when the profile is public (or they follow it)
export interface PublicUserDto extends LimitedUserDto {
  bio: string | null;
}

//what the owner sees
export interface OwnUserDto extends PublicUserDto {
  email: string;
  phone: string | null;
  gender: Gender | null;
  dob: Date | null;
  provider: Provider;
  role: Role;
  isConfirmed: boolean;
  createdAt: Date;
}

//what the admin sees (no phone, no birth date)
export interface AdminUserDto extends LimitedUserDto {
  email: string;
  role: Role;
  provider: Provider;
  isConfirmed: boolean;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

//_________________________________________________________________________________//

//1: toLimitedDto
export const toLimitedDto = (user: UserDocument): LimitedUserDto => ({
  id: user._id.toString(),
  firstName: user.firstName,
  lastName: user.lastName,
  profilePicture: user.profilePicture ?? null,
  isPrivate: user.isPrivate,
});

//_________________________________________________________________________________//

//2: toPublicDto
export const toPublicDto = (user: UserDocument): PublicUserDto => ({
  ...toLimitedDto(user),
  bio: user.bio ?? null,
});

//_________________________________________________________________________________//

//3: toOwnDto
export const toOwnDto = (user: UserDocument): OwnUserDto => ({
  ...toPublicDto(user),
  email: user.email,
  phone: readPhone(user.phone),
  gender: user.gender ?? null,
  dob: user.dob ?? null,
  provider: user.provider,
  role: user.role,
  isConfirmed: user.isConfirmed,
  createdAt: user.createdAt,
});

//_________________________________________________________________________________//

//4: toAdminDto
export const toAdminDto = (user: UserDocument): AdminUserDto => ({
  ...toLimitedDto(user),
  email: user.email,
  role: user.role,
  provider: user.provider,
  isConfirmed: user.isConfirmed,
  isDeleted: user.deletedAt != null,
  deletedAt: user.deletedAt ?? null,
  createdAt: user.createdAt,
});