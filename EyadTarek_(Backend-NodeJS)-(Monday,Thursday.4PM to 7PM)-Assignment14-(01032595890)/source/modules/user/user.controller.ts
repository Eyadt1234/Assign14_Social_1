import { Router } from "express";
import { authentication, getAuth } from "../../middleware/authentication.js";
import { uploadProfilePicture } from "../../middleware/upload.js";
import { paginationSchema } from "../../utils/pagination.js";
import { successResponse } from "../../utils/response.js";
import * as userService from "./user.service.js";
import {
  changePasswordSchema,
  deleteAccountSchema,
  followRequestSchema,
  idParamSchema,
  searchSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from "./user.validation.js";

const router = Router();

router.use(authentication);


//1: my profile
router.get("/profile", async (req, res) => {
  const { user } = getAuth(req);
  successResponse(res, "profile fetched", await userService.getMyProfile(user));
});

//_________________________________________________________________________________//

//2: update my profile
router.patch("/profile", async (req, res) => {
  const { userId } = getAuth(req);
  const data = updateProfileSchema.parse(req.body);
  successResponse(res, "profile updated", await userService.updateProfile(userId, data));
});

//_________________________________________________________________________________//

//2.1: profile picture
router.patch("/profile-picture", uploadProfilePicture, async (req, res) => {
  const { user } = getAuth(req);
  successResponse(res, "profile picture updated", await userService.updateProfilePicture(user, req.file));
});

router.delete("/profile-picture", async (req, res) => {
  const { user } = getAuth(req);
  successResponse(res, "profile picture removed", await userService.removeProfilePicture(user));
});

//_________________________________________________________________________________//

//3: change my password
router.patch("/change-password", async (req, res) => {
  const { userId, sessionId } = getAuth(req);
  const data = changePasswordSchema.parse(req.body);
  await userService.changePassword(userId, sessionId, data);
  successResponse(res, "password changed, the other devices were logged out");
});

//_________________________________________________________________________________//

//3.1: delete my account (soft delete)
router.delete("/account", async (req, res) => {
  const { userId } = getAuth(req);
  const { password } = deleteAccountSchema.parse(req.body ?? {});
  await userService.deleteAccount(userId, password);
  successResponse(res, "account deleted, an admin can restore it");
});

//_________________________________________________________________________________//

//4: account settings (public / private profile)
router.get("/settings", async (req, res) => {
  const { user } = getAuth(req);
  successResponse(res, "settings fetched", userService.getSettings(user));
});

router.patch("/settings", async (req, res) => {
  const { userId } = getAuth(req);
  const { isPrivate } = updateSettingsSchema.parse(req.body);
  successResponse(res, "settings updated", await userService.updateSettings(userId, isPrivate));
});

//_________________________________________________________________________________//

//5: search and suggestions
router.get("/search", async (req, res) => {
  const { userId } = getAuth(req);
  const query = searchSchema.parse(req.query);
  successResponse(res, "search result", await userService.searchUsers(userId, query));
});

router.get("/suggestions", async (req, res) => {
  const { userId } = getAuth(req);
  const query = paginationSchema.parse(req.query);
  successResponse(res, "suggestions fetched", await userService.getSuggestions(userId, query));
});

//_________________________________________________________________________________//

//6: follow requests (private account)
router.get("/follow-requests", async (req, res) => {
  const { userId } = getAuth(req);
  const query = paginationSchema.parse(req.query);
  successResponse(res, "follow requests fetched", await userService.getFollowRequests(userId, query));
});

router.patch("/follow-requests/:id", async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  const { action } = followRequestSchema.parse(req.body);
  await userService.respondToFollowRequest(userId, id, action);
  successResponse(res, action === "accept" ? "follow request accepted" : "follow request rejected");
});

//_________________________________________________________________________________//

//7: profile of another user
router.get("/:id", async (req, res) => {
  const { user } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  successResponse(res, "profile fetched", await userService.getProfile(user, id));
});

//_________________________________________________________________________________//

//8: follow / unfollow
router.post("/:id/follow", async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  const result = await userService.follow(userId, id);
  successResponse(res, result.status === "pending" ? "follow request sent" : "you are following this user now", result, 201);
});

router.delete("/:id/follow", async (req, res) => {
  const { userId } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  await userService.unfollow(userId, id);
  successResponse(res, "unfollowed successfully");
});

//_________________________________________________________________________________//

//9: followers / following lists
router.get("/:id/followers", async (req, res) => {
  const { user } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  const query = paginationSchema.parse(req.query);
  successResponse(res, "followers fetched", await userService.getFollowList(user, id, "followers", query));
});

router.get("/:id/following", async (req, res) => {
  const { user } = getAuth(req);
  const { id } = idParamSchema.parse(req.params);
  const query = paginationSchema.parse(req.query);
  successResponse(res, "following fetched", await userService.getFollowList(user, id, "following", query));
});

export default router;