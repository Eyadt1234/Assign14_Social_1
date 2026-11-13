import { followRepository, userRepository } from "../../DB/repositories/index.js";
import { toAdminDto, type AdminUserDto } from "../../utils/dto.js";
import { AppError } from "../../utils/errors.js";
import { getPageMeta, getSkip, type PageMeta } from "../../utils/pagination.js";
import type { ListUsersDto } from "./admin.validation.js";

export interface AdminUserList extends PageMeta {
  users: AdminUserDto[];
}

//_________________________________________________________________________________//

//1: listUsers
export const listUsers = async (query: ListUsersDto): Promise<AdminUserList> => {
  const { users, total } = await userRepository.listForAdmin(query.status, getSkip(query), query.limit);
  return { users: users.map(toAdminDto), ...getPageMeta(query, total) };
};

//_________________________________________________________________________________//

//2: restoreUser
export const restoreUser = async (id: string): Promise<AdminUserDto> => {
  if (!(await userRepository.restore(id))) {
    throw new AppError("no deleted account with this id", 404);
  }
  await followRepository.resumeFor(id, (otherIds) => userRepository.findDeletedIds(otherIds));

  const user = await userRepository.findById(id);
  if (!user) {
    throw new AppError("user not found", 404);
  }
  return toAdminDto(user);
};