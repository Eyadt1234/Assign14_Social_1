import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";

export const listUsersSchema = paginationSchema.extend({
  status: z.enum(["all", "active", "deleted"], "the status must be all, active or deleted").default("all"),
});

export type ListUsersDto = z.infer<typeof listUsersSchema>;