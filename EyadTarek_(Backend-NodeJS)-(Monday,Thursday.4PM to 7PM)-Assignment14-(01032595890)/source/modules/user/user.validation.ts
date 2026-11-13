import { z } from "zod";
import { paginationSchema } from "../../utils/pagination.js";
import { passwordSchema, phoneSchema } from "../auth/auth.validation.js";

export const idParamSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, "the user id is not valid") });

//strict, so fields like email or password are rejected here
export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(2, "the first name must be at least 2 characters").max(30),
    lastName: z.string().trim().min(2, "the last name must be at least 2 characters").max(30),
    phone: phoneSchema,
    bio: z.string().trim().max(200, "the bio must be at most 200 characters"),
    gender: z.enum(["male", "female"], "the gender must be male or female"),
    dob: z.coerce.date("the date of birth is not valid").refine((date) => date.getTime() < Date.now(), "the date of birth must be in the past"),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, "send at least one field to update");

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, "the old password is required"),
  newPassword: passwordSchema,
});

export const updateSettingsSchema = z.object({ isPrivate: z.boolean("isPrivate must be true or false") }).strict();

export const searchSchema = paginationSchema.extend({
  q: z.string().trim().min(1, "the search text is required").max(50),
});

export const deleteAccountSchema = z.object({ password: z.string().min(1, "the password is required").optional() }).strict();

export const followRequestSchema = z.object({ action: z.enum(["accept", "reject"], "the action must be accept or reject") });

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
export type SearchDto = z.infer<typeof searchSchema>;