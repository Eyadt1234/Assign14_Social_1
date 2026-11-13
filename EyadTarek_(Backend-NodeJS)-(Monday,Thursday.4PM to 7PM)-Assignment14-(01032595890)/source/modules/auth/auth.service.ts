import { randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { env } from "../../config/env.js";
import { sessionRepository, userRepository } from "../../DB/repositories/index.js";
import { toOwnDto, type OwnUserDto } from "../../utils/dto.js";
import { sendOtpEmail } from "../../utils/email.js";
import { encrypt } from "../../utils/encryption.js";
import { AppError } from "../../utils/errors.js";
import { googleAuth } from "../../utils/google.js";
import { checkOtp, ensureOtpStore, releaseOtpSlot, reserveOtpSlot, saveOtp, type OtpType } from "../../utils/otpStore.js";
import { comparePassword, generateOtp, hashPassword } from "../../utils/security.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, type AuthTokens } from "../../utils/token.js";
import type { ConfirmEmailDto, LoginDto, RegisterDto, ResetPasswordDto } from "./auth.validation.js";

//_________________________________________________________________________________//

//1: sendNewOtp
const sendNewOtp = async (type: OtpType, email: string, title: string): Promise<void> => {
  const otp = generateOtp();
  await saveOtp(type, email, otp);
  await sendOtpEmail(email, title, otp);
};

//_________________________________________________________________________________//

//2: sendOtpIfAllowed
const sendOtpIfAllowed = async (type: OtpType, email: string, title: string): Promise<void> => {
  if (!(await reserveOtpSlot(type, email))) {
    return;
  }
  try {
    await sendNewOtp(type, email, title);
  } catch (error) {
    await releaseOtpSlot(type, email);
    throw error;
  }
};

//_________________________________________________________________________________//

//3: createSession
const createSession = async (userId: Types.ObjectId): Promise<AuthTokens> => {
  const jti = randomUUID();
  const session = await sessionRepository.create(userId, jti, new Date(Date.now() + env.refreshExpiresIn * 1000));
  const id = userId.toString();
  const sid = session._id.toString();
  return {
    accessToken: signAccessToken({ id, sid }),
    refreshToken: signRefreshToken({ id, sid, jti }),
  };
};

//_________________________________________________________________________________//

//4: register
export const register = async (data: RegisterDto): Promise<OwnUserDto> => {
  ensureOtpStore();
  if (await userRepository.emailExists(data.email)) {
    throw new AppError("this email is already registered", 409);
  }

  const user = await userRepository.create({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    password: await hashPassword(data.password),
    ...(data.phone ? { phone: encrypt(data.phone) } : {}),
    ...(data.gender ? { gender: data.gender } : {}),
  });
  await sendOtpIfAllowed("confirm", user.email, "Confirm your email");
  return toOwnDto(user);
};

//_________________________________________________________________________________//

//5: confirmEmail
export const confirmEmail = async (data: ConfirmEmailDto): Promise<void> => {
  ensureOtpStore();
  const user = await userRepository.findUnconfirmedByEmail(data.email);
  if (!user) {
    throw new AppError("invalid or expired code", 400);
  }
  await checkOtp("confirm", data.email, data.otp);
  await userRepository.setConfirmed(user._id);
};

//_________________________________________________________________________________//

//6: resendConfirmEmail
export const resendConfirmEmail = async (email: string): Promise<void> => {
  ensureOtpStore();
  const user = await userRepository.findUnconfirmedByEmail(email);
  if (user) {
    await sendOtpIfAllowed("confirm", email, "Confirm your email");
  }
};

//_________________________________________________________________________________//

//7: login
export const login = async (data: LoginDto): Promise<AuthTokens & { user: OwnUserDto }> => {
  const user = await userRepository.findByEmailWithPassword(data.email);
  const passwordMatch = user?.password ? await comparePassword(data.password, user.password) : false;
  if (!user || !passwordMatch) {
    throw new AppError("invalid email or password", 401);
  }
  if (user.deletedAt) {
    throw new AppError("this account was deleted, ask an admin to restore it", 403);
  }
  if (!user.isConfirmed) {
    throw new AppError("please confirm your email first", 403);
  }
  const tokens = await createSession(user._id);
  return { ...tokens, user: toOwnDto(user) };
};

//_________________________________________________________________________________//

//8: refreshToken
export const refreshToken = async (token: string): Promise<AuthTokens> => {
  const payload = verifyRefreshToken(token);
  const session = await sessionRepository.findValid(payload.sid, payload.id);
  if (!session) {
    throw new AppError("session expired or revoked, please login again", 401);
  }

  const user = await userRepository.findById(payload.id);
  if (!user || !user.isConfirmed || user.deletedAt) {
    await sessionRepository.deleteById(session._id);
    throw new AppError("session expired or revoked, please login again", 401);
  }

  //an old refresh token is used again
  const newJti = randomUUID();
  const rotated = session.refreshJti === payload.jti && (await sessionRepository.rotate(session._id, payload.jti, newJti));
  if (!rotated) {
    await sessionRepository.deleteById(session._id);
    throw new AppError("refresh token was already used, the session is revoked", 401);
  }

  return {
    accessToken: signAccessToken({ id: payload.id, sid: payload.sid }),
    refreshToken: signRefreshToken({ id: payload.id, sid: payload.sid, jti: newJti }),
  };
};

//_________________________________________________________________________________//

//9: logout
export const logout = async (sessionId: string): Promise<void> => {
  await sessionRepository.deleteById(sessionId);
};

//_________________________________________________________________________________//

//10: logoutAll
export const logoutAll = async (userId: string): Promise<void> => {
  await sessionRepository.deleteAllOfUser(userId);
};

//_________________________________________________________________________________//

//11: forgotPassword
export const forgotPassword = async (email: string): Promise<void> => {
  ensureOtpStore();
  const user = await userRepository.findActiveByEmail(email);
  if (user) {
    await sendOtpIfAllowed("reset", email, "Reset your password");
  }
};

//_________________________________________________________________________________//

//12: resetPassword
export const resetPassword = async (data: ResetPasswordDto): Promise<void> => {
  ensureOtpStore();
  const user = await userRepository.findActiveByEmail(data.email);
  if (!user) {
    throw new AppError("invalid or expired code", 400);
  }
  await checkOtp("reset", data.email, data.otp);
  await userRepository.setPassword(user._id, await hashPassword(data.newPassword));
  await sessionRepository.deleteAllOfUser(user._id);
};

//_________________________________________________________________________________//

//13: googleLogin
export const googleLogin = async (idToken: string): Promise<AuthTokens & { user: OwnUserDto }> => {
  const profile = await googleAuth.verify(idToken);
  let user = await userRepository.findByEmail(profile.email);

  if (!user) {
    user = await userRepository.create({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      provider: "google",
      isConfirmed: true,
      ...(profile.picture ? { profilePicture: profile.picture } : {}),
    });
  } else if (user.deletedAt) {
    throw new AppError("this account was deleted, ask an admin to restore it", 403);
  } else if (!user.isConfirmed) {
    //someone registered this email without owning it.
    await userRepository.convertToGoogle(user._id);
    user = await userRepository.findById(user._id);
  }

  if (!user) {
    throw new AppError("user not found", 404);
  }
  const tokens = await createSession(user._id);
  return { ...tokens, user: toOwnDto(user) };
};