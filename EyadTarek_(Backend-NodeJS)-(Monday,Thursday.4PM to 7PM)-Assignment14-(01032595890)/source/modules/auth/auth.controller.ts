import { Router } from "express";
import { authentication, getAuth } from "../../middleware/authentication.js";
import { limits, rateLimit } from "../../middleware/rateLimit.js";
import { successResponse } from "../../utils/response.js";
import * as authService from "./auth.service.js";
import {
  confirmEmailSchema,
  emailOnlySchema,
  googleLoginSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.validation.js";

const router = Router();

//1: register
router.post("/register", rateLimit(limits.register), async (req, res) => {
  const data = registerSchema.parse(req.body);
  const user = await authService.register(data);
  successResponse(res, "account created, a code was sent to your email", user, 201);
});

//_________________________________________________________________________________//

//2: confirm email
router.post("/confirm-email", rateLimit(limits.confirmEmail), async (req, res) => {
  const data = confirmEmailSchema.parse(req.body);
  await authService.confirmEmail(data);
  successResponse(res, "email confirmed, you can login now");
});

//_________________________________________________________________________________//

//3: resend the confirmation code
router.post("/resend-confirm-email", rateLimit(limits.resendOtp), async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  await authService.resendConfirmEmail(email);
  successResponse(res, "if the email needs confirmation, a new code was sent");
});

//_________________________________________________________________________________//

//4: login
router.post("/login", rateLimit(limits.login), async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data);
  successResponse(res, "logged in successfully", result);
});

//_________________________________________________________________________________//

//5: refresh token
router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = refreshTokenSchema.parse(req.body);
  const tokens = await authService.refreshToken(refreshToken);
  successResponse(res, "tokens refreshed", tokens);
});

//_________________________________________________________________________________//

//6: logout (current session)
router.post("/logout", authentication, async (req, res) => {
  const { sessionId } = getAuth(req);
  await authService.logout(sessionId);
  successResponse(res, "logged out successfully");
});

//_________________________________________________________________________________//

//7: logout from all devices
router.post("/logout-all", authentication, async (req, res) => {
  const { userId } = getAuth(req);
  await authService.logoutAll(userId);
  successResponse(res, "logged out from all devices");
});

//_________________________________________________________________________________//

//8: forgot password
router.post("/forgot-password", rateLimit(limits.forgotPassword), async (req, res) => {
  const { email } = emailOnlySchema.parse(req.body);
  await authService.forgotPassword(email);
  successResponse(res, "if the email is registered, a reset code was sent");
});

//_________________________________________________________________________________//

//9: reset password
router.post("/reset-password", rateLimit(limits.resetPassword), async (req, res) => {
  const data = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(data);
  successResponse(res, "password changed, please login again");
});

//_________________________________________________________________________________//

//10: google sign in
router.post("/google", rateLimit(limits.google), async (req, res) => {
  const { idToken } = googleLoginSchema.parse(req.body);
  const result = await authService.googleLogin(idToken);
  successResponse(res, "logged in with google successfully", result);
});

export default router;