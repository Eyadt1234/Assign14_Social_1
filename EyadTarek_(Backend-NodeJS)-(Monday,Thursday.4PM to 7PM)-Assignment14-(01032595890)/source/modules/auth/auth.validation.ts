import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email("the email is not valid"));

export const passwordSchema = z
  .string()
  .min(8, "the password must be at least 8 characters")
  .max(64, "the password must be at most 64 characters")
  .regex(/[a-z]/, "the password must contain a lowercase letter")
  .regex(/[A-Z]/, "the password must contain an uppercase letter")
  .regex(/\d/, "the password must contain a number");

export const phoneSchema = z.string().trim().regex(/^01[0125]\d{8}$/, "the phone must be a valid egyptian number");

export const otpSchema = z.string().trim().regex(/^\d{6}$/, "the code must be 6 digits");

//_________________________________________________________________________________//

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(2, "the first name must be at least 2 characters").max(30),
    lastName: z.string().trim().min(2, "the last name must be at least 2 characters").max(30),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    phone: phoneSchema.optional(),
    gender: z.enum(["male", "female"], "the gender must be male or female").optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "the passwords do not match",
    path: ["confirmPassword"],
  });

export const confirmEmailSchema = z.object({ email: emailSchema, otp: otpSchema });

export const emailOnlySchema = z.object({ email: emailSchema });

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "the password is required") });

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1, "the refresh token is required") });

export const resetPasswordSchema = z.object({ email: emailSchema, otp: otpSchema, newPassword: passwordSchema });

export const googleLoginSchema = z.object({ idToken: z.string().min(1, "the google id token is required") });

export type RegisterDto = z.infer<typeof registerSchema>;
export type ConfirmEmailDto = z.infer<typeof confirmEmailSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;