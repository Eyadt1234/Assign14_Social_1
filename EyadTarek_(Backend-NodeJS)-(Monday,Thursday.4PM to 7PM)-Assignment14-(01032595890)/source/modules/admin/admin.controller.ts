import { Router } from "express";
import { authentication } from "../../middleware/authentication.js";
import { authorization } from "../../middleware/authorization.js";
import { successResponse } from "../../utils/response.js";
import { idParamSchema } from "../user/user.validation.js";
import * as adminService from "./admin.service.js";
import { listUsersSchema } from "./admin.validation.js";

const router = Router();

//admin only
router.use(authentication, authorization("admin"));

//1: list the users
router.get("/users", async (req, res) => {
  const query = listUsersSchema.parse(req.query);
  successResponse(res, "users fetched", await adminService.listUsers(query));
});

//_________________________________________________________________________________//

//2: restore a deleted account
router.patch("/users/:id/restore", async (req, res) => {
  const { id } = idParamSchema.parse(req.params);
  successResponse(res, "account restored", await adminService.restoreUser(id));
});

export default router;