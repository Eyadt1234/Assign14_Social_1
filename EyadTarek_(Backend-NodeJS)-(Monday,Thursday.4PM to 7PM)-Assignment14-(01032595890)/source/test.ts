import "./testEnv.js";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, connect } from "node:net";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { createClient } from "redis";
import type { AddressInfo } from "node:net";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectRedis, disconnectRedis, redis } from "./config/redis.js";
import { connectDB } from "./DB/connection.js";
import { Follow } from "./DB/models/follow.model.js";
import { migrate } from "./DB/migration.js";
import { Session } from "./DB/models/session.model.js";
import { User } from "./DB/models/user.model.js";
import { userRepository } from "./DB/repositories/index.js";
import { limits } from "./middleware/rateLimit.js";
import { checkMongoUri, checkRedisUri, cleanTestRedis, sentinelKey, verifyTestMongo, verifyTestRedis } from "./testGuard.js";
import { sentEmails } from "./utils/email.js";
import { decrypt, encrypt, readPhone } from "./utils/encryption.js";
import { AppError } from "./utils/errors.js";
import { googleAuth } from "./utils/google.js";
import { cooldownKey, otpKey } from "./utils/otpStore.js";

let passed = 0;
let failed = 0;
let skipped = 0;

const print = console.log;
console.log = () => {};

class SkipTest extends Error {}

//1: test
const test = async (name: string, run: () => Promise<void>): Promise<void> => {
  try {
    await run();
    passed++;
    print(`  PASS  ${name}`);
  } catch (error) {
    if (error instanceof SkipTest) {
      skipped++;
      print(`  SKIP  ${name} (${error.message})`);
      return;
    }
    failed++;
    print(` FAIL ${name}\n ${(error as Error).message}`);
  }
};

//_________________________________________________________________________________//

//1.1: skip
const skip = (name: string, reason: string): void => {
  skipped++;
  print(`  SKIP  ${name} (${reason})`);
};

//_________________________________________________________________________________//

//2: check
const check = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

//_________________________________________________________________________________//

interface ApiResult<T> {
  status: number;
  message: string;
  data: T;
}

type Plain = Record<string, unknown>;

interface TokensData {
  accessToken: string;
  refreshToken: string;
}

interface LoginData extends TokensData {
  user: Plain;
}

interface ProfileData {
  profile: Plain;
  followersCount: number;
  followingCount: number;
  followStatus: string;
  canViewProfile: boolean;
}

interface ListData {
  users: { id: string; firstName: string; lastName: string }[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

//_________________________________________________________________________________//

//4: api
let baseUrl = "";

const api = async <T = Plain>(method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const json = (await response.json()) as { message: string; data: T };
  return { status: response.status, message: json.message, data: json.data };
};

//_________________________________________________________________________________//

//5: getOtp
const getOtp = (email: string): string => {
  const mail = sentEmails.filter((item) => item.to === email).at(-1);
  const otp = mail?.html.match(/<b>(\d{6})<\/b>/)?.[1];
  if (!otp) {
    throw new Error(`no code email for ${email}`);
  }
  return otp;
};

const emailsCount = (email: string): number => sentEmails.filter((item) => item.to === email).length;

//_________________________________________________________________________________//

//6: makers
const password = "Eyad0124!";
let counter = 0;

const makeEmail = (name: string): string => `${name.toLowerCase()}${++counter}@gmail.com`;

const registerBody = (email: string, firstName: string = "Eyad"): Plain => ({
  firstName,
  lastName: "Tarek",
  email,
  password,
  confirmPassword: password,
});

interface Account {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
}

//register + confirm + login
const makeAccount = async (firstName: string = "Eyad"): Promise<Account> => {
  const email = makeEmail(firstName);
  const registered = await api<Plain>("POST", "/auth/register", registerBody(email, firstName));
  check(registered.status === 201, `register failed: ${registered.message}`);
  const confirmed = await api("POST", "/auth/confirm-email", { email, otp: getOtp(email) });
  check(confirmed.status === 200, `confirm failed: ${confirmed.message}`);
  const login = await api<LoginData>("POST", "/auth/login", { email, password });
  check(login.status === 200, `login failed: ${login.message}`);
  return { id: login.data.user.id as string, email, token: login.data.accessToken, refreshToken: login.data.refreshToken };
};

const loginAgain = async (email: string, pass: string = password): Promise<LoginData> => {
  const login = await api<LoginData>("POST", "/auth/login", { email, password: pass });
  check(login.status === 200, `login failed: ${login.message}`);
  return login.data;
};

//_________________________________________________________________________________//

//7: setup
await connectDB();
verifyTestMongo(mongoose.connection.name, mongoose.connection.host);
await mongoose.connection.dropDatabase();
await mongoose.syncIndexes();
await connectRedis();
await cleanTestRedis(redis, env.redisUri);
env.saltRounds = 4; //faster hashing for the tests
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

//_________________________________________________________________________________//

print("\n1 - Auth: registration and email verification");

await test("register creates an unconfirmed user and sends a code", async () => {
  const email = makeEmail("reg");
  const res = await api<Plain>("POST", "/auth/register", registerBody(email));
  check(res.status === 201, `status ${res.status}`);
  check(res.data.email === email && res.data.isConfirmed === false, "wrong user data");
  check(!("password" in res.data), "password leaked");
  check(emailsCount(email) === 1 && getOtp(email).length === 6, "code email was not sent");
});

await test("the password and the code are saved hashed", async () => {
  const email = makeEmail("hash");
  await api("POST", "/auth/register", registerBody(email));
  const user = await User.findOne({ email }).select("+password");
  check(!!user?.password && user.password !== password && user.password.startsWith("$2"), "password is not hashed");
  const code = await redis.hGet(otpKey("confirm", email), "code");
  check(!!code && code !== getOtp(email) && code.length === 64, "code is not hashed");
});

await test("register validates the body", async () => {
  const email = makeEmail("bad");
  const cases: Plain[] = [
    { ...registerBody(email), email: "not-an-email" },
    { ...registerBody(email), password: "weak", confirmPassword: "weak" },
    { ...registerBody(email), confirmPassword: "Different0124!" },
    { ...registerBody(email), phone: "123" },
    { ...registerBody(email), firstName: "E" },
    {},
  ];
  for (const body of cases) {
    const res = await api("POST", "/auth/register", body);
    check(res.status === 400, `${JSON.stringify(body)} gave ${res.status}`);
  }
  check((await User.countDocuments({ email })) === 0, "an invalid user was saved");
});

await test("the same email can't be registered twice (any letter case)", async () => {
  const email = makeEmail("dup");
  await api("POST", "/auth/register", registerBody(email));
  const res = await api("POST", "/auth/register", registerBody(email.toUpperCase()));
  check(res.status === 409, `status ${res.status}`);
});

await test("login is blocked until the email is confirmed", async () => {
  const email = makeEmail("unconfirmed");
  await api("POST", "/auth/register", registerBody(email));
  const res = await api("POST", "/auth/login", { email, password });
  check(res.status === 403, `status ${res.status}`);
});

await test("a wrong code is rejected and the right code confirms the email", async () => {
  const email = makeEmail("confirm");
  await api("POST", "/auth/register", registerBody(email));
  const otp = getOtp(email);
  const wrong = await api("POST", "/auth/confirm-email", { email, otp: otp === "111111" ? "222222" : "111111" });
  check(wrong.status === 400, `wrong code gave ${wrong.status}`);
  const right = await api("POST", "/auth/confirm-email", { email, otp });
  check(right.status === 200, `right code gave ${right.status}`);
  const again = await api("POST", "/auth/confirm-email", { email, otp });
  check(again.status === 400, "a confirmed email accepted a code again");
  check((await User.findOne({ email }))?.isConfirmed === true, "user is not confirmed");
});

await test("an expired code is rejected", async () => {
  const email = makeEmail("expired");
  await api("POST", "/auth/register", registerBody(email));
  const otp = getOtp(email);
  await redis.pExpire(otpKey("confirm", email), 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const res = await api("POST", "/auth/confirm-email", { email, otp });
  check(res.status === 400 && res.message.includes("expired"), `status ${res.status}: ${res.message}`);
});

await test("5 wrong tries lock the code, even the right code is rejected", async () => {
  const email = makeEmail("locked");
  await api("POST", "/auth/register", registerBody(email));
  const otp = getOtp(email);
  const wrong = otp === "111111" ? "222222" : "111111";
  for (let i = 0; i < env.otpMaxAttempts; i++) {
    check((await api("POST", "/auth/confirm-email", { email, otp: wrong })).status === 400, "wrong try was not rejected");
  }
  const res = await api("POST", "/auth/confirm-email", { email, otp });
  check(res.status === 429, `status ${res.status}`);
});

await test("resend sends a new code only after the delay, and the old code stops working", async () => {
  const email = makeEmail("resend");
  await api("POST", "/auth/register", registerBody(email));
  const oldOtp = getOtp(email);

  await api("POST", "/auth/resend-confirm-email", { email });
  check(emailsCount(email) === 1, "a second code was sent before the delay");

  await redis.del(cooldownKey("confirm", email));
  const res = await api("POST", "/auth/resend-confirm-email", { email });
  check(res.status === 200 && emailsCount(email) === 2, "new code was not sent");
  const newOtp = getOtp(email);
  if (newOtp !== oldOtp) {
    check((await api("POST", "/auth/confirm-email", { email, otp: oldOtp })).status === 400, "old code still works");
  }
  check((await api("POST", "/auth/confirm-email", { email, otp: newOtp })).status === 200, "new code failed");
});

await test("resend gives the same answer for an unknown email and sends nothing", async () => {
  const email = makeEmail("nobody");
  const res = await api("POST", "/auth/resend-confirm-email", { email });
  check(res.status === 200 && emailsCount(email) === 0, "unknown email was treated differently");
});

//_________________________________________________________________________________//

print("\n2 - Auth: login and sessions (access token + refresh token)");

await test("login returns an access token, a refresh token and the user", async () => {
  const account = await makeAccount();
  const data = await loginAgain(account.email);
  check(!!data.accessToken && !!data.refreshToken && data.accessToken !== data.refreshToken, "tokens are missing");
  check(data.user.email === account.email && !("password" in data.user), "wrong user data");
});

await test("wrong password and unknown email give the same 401", async () => {
  const account = await makeAccount();
  const wrong = await api("POST", "/auth/login", { email: account.email, password: "Wrong0124!" });
  const unknown = await api("POST", "/auth/login", { email: makeEmail("ghost"), password });
  check(wrong.status === 401 && unknown.status === 401 && wrong.message === unknown.message, "answers are different");
});

await test("protected routes need a valid access token", async () => {
  const account = await makeAccount();
  check((await api("GET", "/users/profile")).status === 401, "no token was accepted");
  check((await api("GET", "/users/profile", undefined, "garbage")).status === 401, "garbage token was accepted");
  check((await api("GET", "/users/profile", undefined, account.refreshToken)).status === 401, "refresh token worked as access token");
  const expired = jwt.sign({ id: account.id, sid: "x" }, env.accessSecret, { expiresIn: -10 });
  check((await api("GET", "/users/profile", undefined, expired)).status === 401, "expired token was accepted");
  check((await api("GET", "/users/profile", undefined, account.token)).status === 200, "valid token was rejected");
});

await test("refresh gives new tokens and every refresh token works only once", async () => {
  const account = await makeAccount();
  const refreshed = await api<TokensData>("POST", "/auth/refresh-token", { refreshToken: account.refreshToken });
  check(refreshed.status === 200, `status ${refreshed.status}`);
  check((await api("GET", "/users/profile", undefined, refreshed.data.accessToken)).status === 200, "new access token failed");

  const reused = await api("POST", "/auth/refresh-token", { refreshToken: account.refreshToken });
  check(reused.status === 401, "old refresh token worked again");
  const afterReuse = await api("POST", "/auth/refresh-token", { refreshToken: refreshed.data.refreshToken });
  check(afterReuse.status === 401, "the session was not revoked after the reuse");
  check((await api("GET", "/users/profile", undefined, refreshed.data.accessToken)).status === 401, "access token of a revoked session still works");
});

await test("an access token can't be used as a refresh token", async () => {
  const account = await makeAccount();
  const res = await api("POST", "/auth/refresh-token", { refreshToken: account.token });
  check(res.status === 401, `status ${res.status}`);
});

await test("logout revokes only the current session", async () => {
  const account = await makeAccount();
  const second = await loginAgain(account.email);
  check((await api("POST", "/auth/logout", undefined, account.token)).status === 200, "logout failed");
  check((await api("GET", "/users/profile", undefined, account.token)).status === 401, "revoked token still works");
  check((await api("GET", "/users/profile", undefined, second.accessToken)).status === 200, "other session was revoked");
  check((await api("POST", "/auth/refresh-token", { refreshToken: account.refreshToken })).status === 401, "refresh works after logout");
});

await test("logout-all revokes every session of the user", async () => {
  const account = await makeAccount();
  const second = await loginAgain(account.email);
  check((await api("POST", "/auth/logout-all", undefined, second.accessToken)).status === 200, "logout-all failed");
  check((await api("GET", "/users/profile", undefined, account.token)).status === 401, "first session still works");
  check((await api("GET", "/users/profile", undefined, second.accessToken)).status === 401, "second session still works");
  check((await Session.countDocuments({ userId: account.id })) === 0, "sessions are still saved");
});

//_________________________________________________________________________________//

print("\n3 - Auth: password reset");

await test("forgot password sends a code only to a confirmed account, with the same answer", async () => {
  const account = await makeAccount();
  const unknown = makeEmail("ghost");
  const unconfirmed = makeEmail("pending");
  await api("POST", "/auth/register", registerBody(unconfirmed));
  const before = emailsCount(unconfirmed);

  const known = await api("POST", "/auth/forgot-password", { email: account.email });
  const missing = await api("POST", "/auth/forgot-password", { email: unknown });
  await api("POST", "/auth/forgot-password", { email: unconfirmed });
  check(known.status === 200 && missing.status === 200 && known.message === missing.message, "answers are different");
  check(emailsCount(account.email) === 2 && emailsCount(unknown) === 0, "wrong emails were sent");
  check(emailsCount(unconfirmed) === before, "an unconfirmed account got a reset code");
});

await test("reset password: wrong code, weak password, then success", async () => {
  const account = await makeAccount();
  await api("POST", "/auth/forgot-password", { email: account.email });
  const otp = getOtp(account.email);
  const newPassword = "NewPass0124!";

  const wrong = await api("POST", "/auth/reset-password", { email: account.email, otp: otp === "111111" ? "222222" : "111111", newPassword });
  check(wrong.status === 400, `wrong code gave ${wrong.status}`);
  const weak = await api("POST", "/auth/reset-password", { email: account.email, otp, newPassword: "weak" });
  check(weak.status === 400, `weak password gave ${weak.status}`);

  const done = await api("POST", "/auth/reset-password", { email: account.email, otp, newPassword });
  check(done.status === 200, `reset gave ${done.status}`);
  check((await api("POST", "/auth/login", { email: account.email, password })).status === 401, "old password still works");
  await loginAgain(account.email, newPassword);
  check((await api("GET", "/users/profile", undefined, account.token)).status === 401, "old session survived the reset");
  check((await api("POST", "/auth/reset-password", { email: account.email, otp, newPassword })).status === 400, "the code was used twice");
});

//_________________________________________________________________________________//

print("\n4 - Auth: Google sign-in (OAuth 2.0)");

const realVerify = googleAuth.verify;
googleAuth.verify = async (idToken: string) => {
  if (idToken === "google-new") {
    return { email: "google.new@gmail.com", firstName: "Gogo", lastName: "Gle", picture: "https://example.com/p.png" };
  }
  if (idToken === "google-pending") {
    return { email: "google.pending@gmail.com", firstName: "Real", lastName: "Owner", picture: null };
  }
  throw new AppError("invalid google token", 401);
};

await test("a new google user is created confirmed, without a password", async () => {
  const res = await api<LoginData>("POST", "/auth/google", { idToken: "google-new" });
  check(res.status === 200 && !!res.data.accessToken && !!res.data.refreshToken, `status ${res.status}`);
  check(res.data.user.provider === "google" && res.data.user.profilePicture === "https://example.com/p.png", "wrong user data");
  const user = await User.findOne({ email: "google.new@gmail.com" }).select("+password");
  check(user?.isConfirmed === true && !user.password, "wrong saved user");
  check((await api("GET", "/users/profile", undefined, res.data.accessToken)).status === 200, "google token does not work");
});

await test("the same google user logs in again without a second account", async () => {
  await api("POST", "/auth/google", { idToken: "google-new" });
  check((await User.countDocuments({ email: "google.new@gmail.com" })) === 1, "a duplicate user was created");
});

await test("an invalid google token is rejected", async () => {
  check((await api("POST", "/auth/google", { idToken: "fake" })).status === 401, "fake token accepted");
  check((await api("POST", "/auth/google", {})).status === 400, "missing token accepted");
});

await test("google sign-in removes the password of an unconfirmed account made by someone else", async () => {
  await api("POST", "/auth/register", registerBody("google.pending@gmail.com"));
  const res = await api<LoginData>("POST", "/auth/google", { idToken: "google-pending" });
  check(res.status === 200, `status ${res.status}`);
  check((await api("POST", "/auth/login", { email: "google.pending@gmail.com", password })).status === 401, "the old password still works");
});

googleAuth.verify = realVerify;

await test("without a google client id the real verify says it is not configured", async () => {
  env.googleClientId = "";
  const res = await api("POST", "/auth/google", { idToken: "anything" });
  check(res.status === 501, `status ${res.status}`);
});

//_________________________________________________________________________________//

print("\n5 - User: profile and account settings");

await test("my profile shows my data and no secrets", async () => {
  const account = await makeAccount();
  const res = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(res.status === 200 && res.data.followStatus === "self", `status ${res.status}`);
  check(res.data.profile.email === account.email && res.data.followersCount === 0, "wrong data");
  check(!("password" in res.data.profile) && !("confirmEmailOtp" in res.data.profile), "secret field leaked");
});

await test("update profile changes only the sent fields", async () => {
  const account = await makeAccount();
  const res = await api<Plain>("PATCH", "/users/profile", { bio: "backend student", phone: "01012345678", gender: "male" }, account.token);
  check(res.status === 200 && res.data.bio === "backend student" && res.data.phone === "01012345678", `status ${res.status}`);
  check(res.data.firstName === "Eyad" && res.data.email === account.email, "other fields changed");
});

await test("update profile rejects wrong values and fields that can't be changed", async () => {
  const account = await makeAccount();
  const cases: Plain[] = [
    {},
    { phone: "123" },
    { email: "other@gmail.com" },
    { password: "Hacked0124!" },
    { isPrivate: true },
    { role: "admin" },
    { deletedAt: null },
    { dob: "2999-01-01" },
    { gender: "robot" },
    { profilePicture: "not a link" },
    { bio: "x".repeat(201) },
  ];
  for (const body of cases) {
    const res = await api("PATCH", "/users/profile", body, account.token);
    check(res.status === 400, `${JSON.stringify(body).slice(0, 40)} gave ${res.status}`);
  }
});

await test("change password: wrong old, same password, then success (other devices are logged out)", async () => {
  const account = await makeAccount();
  const other = await loginAgain(account.email);
  const newPassword = "NewPass0124!";
  check((await api("PATCH", "/users/change-password", { oldPassword: "Wrong0124!", newPassword }, account.token)).status === 400, "wrong old password accepted");
  check((await api("PATCH", "/users/change-password", { oldPassword: password, newPassword: password }, account.token)).status === 400, "same password accepted");
  check((await api("PATCH", "/users/change-password", { oldPassword: password, newPassword: "weak" }, account.token)).status === 400, "weak password accepted");

  check((await api("PATCH", "/users/change-password", { oldPassword: password, newPassword }, account.token)).status === 200, "change failed");
  check((await api("GET", "/users/profile", undefined, account.token)).status === 200, "the current session was revoked");
  check((await api("GET", "/users/profile", undefined, other.accessToken)).status === 401, "the other session survived");
  await loginAgain(account.email, newPassword);
});

await test("settings: public by default, only a boolean is accepted", async () => {
  const account = await makeAccount();
  const settings = await api<{ isPrivate: boolean }>("GET", "/users/settings", undefined, account.token);
  check(settings.status === 200 && settings.data.isPrivate === false, "default is not public");
  check((await api("PATCH", "/users/settings", { isPrivate: "yes" }, account.token)).status === 400, "text accepted");
  check((await api("PATCH", "/users/settings", { isPrivate: true, role: "admin" }, account.token)).status === 400, "extra field accepted");
  const changed = await api<{ isPrivate: boolean }>("PATCH", "/users/settings", { isPrivate: true }, account.token);
  check(changed.status === 200 && changed.data.isPrivate === true, "settings were not changed");
});

//_________________________________________________________________________________//

print("\n6 - User: follow / unfollow (public profiles)");

await test("follow and unfollow update the counts and the follow status", async () => {
  const a = await makeAccount("Followa");
  const b = await makeAccount("Followb");
  const followed = await api<{ status: string }>("POST", `/users/${b.id}/follow`, undefined, a.token);
  check(followed.status === 201 && followed.data.status === "accepted", `status ${followed.status}`);

  const profile = await api<ProfileData>("GET", `/users/${b.id}`, undefined, a.token);
  check(profile.data.followersCount === 1 && profile.data.followStatus === "following", "wrong follow data");
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, a.token);
  check(mine.data.followingCount === 1, "following count is wrong");

  check((await api("DELETE", `/users/${b.id}/follow`, undefined, a.token)).status === 200, "unfollow failed");
  const after = await api<ProfileData>("GET", `/users/${b.id}`, undefined, a.token);
  check(after.data.followersCount === 0 && after.data.followStatus === "none", "unfollow did not update");
});

await test("follow rules: yourself, twice, unknown user, bad id, unfollow without follow", async () => {
  const a = await makeAccount("Rulea");
  const b = await makeAccount("Ruleb");
  check((await api("POST", `/users/${a.id}/follow`, undefined, a.token)).status === 400, "followed myself");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  check((await api("POST", `/users/${b.id}/follow`, undefined, a.token)).status === 409, "followed twice");
  check((await api("POST", `/users/${new mongoose.Types.ObjectId().toString()}/follow`, undefined, a.token)).status === 404, "followed an unknown user");
  check((await api("POST", "/users/123/follow", undefined, a.token)).status === 400, "bad id accepted");
  check((await api("DELETE", `/users/${a.id}/follow`, undefined, b.token)).status === 404, "unfollowed without following");
});

await test("followers and following lists with pagination", async () => {
  const star = await makeAccount("Star");
  const fans = [await makeAccount("Fana"), await makeAccount("Fanb"), await makeAccount("Fanc")];
  for (const fan of fans) {
    await api("POST", `/users/${star.id}/follow`, undefined, fan.token);
  }
  const first = await api<ListData>("GET", `/users/${star.id}/followers?limit=2`, undefined, fans[0]!.token);
  check(first.data.users.length === 2 && first.data.total === 3, "wrong first page");
  const second = await api<ListData>("GET", `/users/${star.id}/followers?limit=2&page=2`, undefined, fans[0]!.token);
  check(second.data.users.length === 1, "wrong second page");
  const following = await api<ListData>("GET", `/users/${fans[0]!.id}/following`, undefined, star.token);
  check(following.data.total === 1 && following.data.users[0]?.id === star.id, "wrong following list");
  check((await api("GET", `/users/${star.id}/followers?limit=500`, undefined, star.token)).status === 400, "huge limit accepted");
});

//_________________________________________________________________________________//

print("\n7 - User: private profile (public vs private)");

await test("a private profile shows only the basic info to a user who doesn't follow it", async () => {
  const owner = await makeAccount("Privatea");
  const visitor = await makeAccount("Visitora");
  await api("PATCH", "/users/profile", { bio: "secret bio" }, owner.token);
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);

  const view = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, visitor.token);
  check(view.status === 200 && view.data.canViewProfile === false, "private profile is open");
  check(!("bio" in view.data.profile) && !("email" in view.data.profile), "private data leaked");
  check((await api("GET", `/users/${owner.id}/followers`, undefined, visitor.token)).status === 403, "followers list is open");
  check((await api("GET", `/users/${owner.id}/following`, undefined, visitor.token)).status === 403, "following list is open");

  const mine = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, owner.token);
  check(mine.data.profile.bio === "secret bio", "the owner can't see his profile");
});

await test("following a private account creates a request, accept opens the profile", async () => {
  const owner = await makeAccount("Privateb");
  const visitor = await makeAccount("Visitorb");
  const other = await makeAccount("Otherb");
  await api("PATCH", "/users/profile", { bio: "secret bio" }, owner.token);
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);

  const followed = await api<{ status: string }>("POST", `/users/${owner.id}/follow`, undefined, visitor.token);
  check(followed.status === 201 && followed.data.status === "pending", "follow was not pending");
  check((await api("POST", `/users/${owner.id}/follow`, undefined, visitor.token)).status === 409, "request sent twice");

  const pendingView = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, visitor.token);
  check(pendingView.data.followStatus === "pending" && pendingView.data.canViewProfile === false, "pending user can see the profile");
  const counts = await api<ProfileData>("GET", "/users/profile", undefined, owner.token);
  check(counts.data.followersCount === 0, "a pending request was counted");

  const requests = await api<ListData>("GET", "/users/follow-requests", undefined, owner.token);
  check(requests.data.total === 1 && requests.data.users[0]?.id === visitor.id, "request is not in the list");
  check((await api("PATCH", `/users/follow-requests/${visitor.id}`, { action: "accept" }, other.token)).status === 404, "a stranger accepted the request");
  check((await api("PATCH", `/users/follow-requests/${visitor.id}`, { action: "maybe" }, owner.token)).status === 400, "wrong action accepted");

  check((await api("PATCH", `/users/follow-requests/${visitor.id}`, { action: "accept" }, owner.token)).status === 200, "accept failed");
  const view = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, visitor.token);
  check(view.data.canViewProfile === true && view.data.profile.bio === "secret bio" && view.data.followStatus === "following", "accepted follower can't see the profile");
  check((await api("GET", `/users/${owner.id}/followers`, undefined, visitor.token)).status === 200, "follower can't see the list");
  check((await api("PATCH", `/users/follow-requests/${visitor.id}`, { action: "accept" }, owner.token)).status === 404, "request accepted twice");
});

await test("reject deletes the request, and a pending request can be cancelled by unfollow", async () => {
  const owner = await makeAccount("Privatec");
  const first = await makeAccount("Visitorc");
  const second = await makeAccount("Visitord");
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, first.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, second.token);

  check((await api("PATCH", `/users/follow-requests/${first.id}`, { action: "reject" }, owner.token)).status === 200, "reject failed");
  check((await Follow.countDocuments({ follower: first.id, following: owner.id })) === 0, "rejected request is still saved");
  check((await api("DELETE", `/users/${owner.id}/follow`, undefined, second.token)).status === 200, "cancel request failed");
  const requests = await api<ListData>("GET", "/users/follow-requests", undefined, owner.token);
  check(requests.data.total === 0, "requests are still waiting");
});

await test("switching a profile to public accepts the waiting requests", async () => {
  const owner = await makeAccount("Privated");
  const visitor = await makeAccount("Visitore");
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, visitor.token);
  await api("PATCH", "/users/settings", { isPrivate: false }, owner.token);
  const view = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, visitor.token);
  check(view.data.followStatus === "following" && view.data.canViewProfile === true, "request was not accepted");
});

//_________________________________________________________________________________//

print("\n8 - User: search and suggestions");

await test("search finds users by first or last name, without me and without unconfirmed users", async () => {
  const me = await makeAccount("Findme");
  await makeAccount("Findme");
  await api("POST", "/auth/register", registerBody(makeEmail("findme"), "Findme"));

  const res = await api<ListData>("GET", "/users/search?q=findme", undefined, me.token);
  check(res.status === 200 && res.data.total === 1, `total ${res.data.total}`);
  check(!res.data.users.some((user) => user.id === me.id), "my own account is in the result");
  check(!("email" in (res.data.users[0] ?? {})), "email leaked in the search");

  const byLastName = await api<ListData>("GET", "/users/search?q=FINDME tarek", undefined, me.token);
  check(byLastName.data.total === 1, "first + last name search failed");
});

await test("search paginates, needs a text and treats special characters as text", async () => {
  const me = await makeAccount("Pagea");
  await makeAccount("Pagea");
  await makeAccount("Pagea");
  const page = await api<ListData>("GET", "/users/search?q=pagea&limit=1&page=2", undefined, me.token);
  check(page.data.users.length === 1 && page.data.total === 2 && page.data.page === 2, "wrong page");
  check((await api("GET", "/users/search", undefined, me.token)).status === 400, "search without text accepted");
  const regex = await api<ListData>("GET", `/users/search?q=${encodeURIComponent(".*")}`, undefined, me.token);
  check(regex.status === 200 && regex.data.total === 0, "special characters worked as a regex");
});

await test("suggestions: people followed by the people I follow come first", async () => {
  const a = await makeAccount("Suga");
  const b = await makeAccount("Sugb");
  const c = await makeAccount("Sugc");
  const d = await makeAccount("Sugd");
  const e = await makeAccount("Suge");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  await api("POST", `/users/${c.id}/follow`, undefined, a.token);
  await api("POST", `/users/${d.id}/follow`, undefined, b.token);
  await api("POST", `/users/${e.id}/follow`, undefined, b.token);
  await api("POST", `/users/${d.id}/follow`, undefined, c.token);

  const res = await api<ListData>("GET", "/users/suggestions?limit=5", undefined, a.token);
  const ids = res.data.users.map((user) => user.id);
  check(res.status === 200 && ids.length === 5, `got ${ids.length} suggestions`);
  check(ids[0] === d.id && ids[1] === e.id, "the order is not by mutual follows");
  check(![a.id, b.id, c.id].some((id) => ids.includes(id)), "me or a followed user is suggested");
});

await test("suggestions skip users with a pending request", async () => {
  const a = await makeAccount("Pena");
  const b = await makeAccount("Penb");
  await api("PATCH", "/users/settings", { isPrivate: true }, b.token);
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  const res = await api<ListData>("GET", "/users/suggestions?limit=50", undefined, a.token);
  check(!res.data.users.some((user) => user.id === b.id), "a pending user is suggested");
});

//_________________________________________________________________________________//

print("\n9 - App");

await test("unknown routes and broken json get a clean error", async () => {
  check((await api("GET", "/nothing")).status === 404, "unknown route is not 404");
  const broken = await api("POST", "/auth/login", "{ not json");
  check(broken.status === 400 && broken.message === "invalid request body", `status ${broken.status}`);
});

//_________________________________________________________________________________//

print("\n10 - Redis (real redis server, database 15)");

await test("the code is saved in redis hashed, with an expiry time, and a right code works only once", async () => {
  const email = makeEmail("redis");
  await api("POST", "/auth/register", registerBody(email));
  const key = otpKey("confirm", email);
  const ttl = await redis.ttl(key);
  check(ttl > 0 && ttl <= env.otpExpiresIn, `ttl is ${ttl}`);
  const cooldown = await redis.ttl(cooldownKey("confirm", email));
  check(cooldown > 0 && cooldown <= env.otpResendDelay, `cooldown ttl is ${cooldown}`);
  check((await User.collection.findOne({ email }))?.confirmEmailOtp === undefined, "the code is also saved in mongodb");

  const otp = getOtp(email);
  check((await api("POST", "/auth/confirm-email", { email, otp })).status === 200, "confirm failed");
  check((await redis.exists(key)) === 0, "the code is still in redis after it was used");
});

await test("wrong tries are counted in redis and a new code starts from 0", async () => {
  const email = makeEmail("attempts");
  await api("POST", "/auth/register", registerBody(email));
  const otp = getOtp(email);
  const wrong = otp === "111111" ? "222222" : "111111";
  await api("POST", "/auth/confirm-email", { email, otp: wrong });
  await api("POST", "/auth/confirm-email", { email, otp: wrong });
  check((await redis.hGet(otpKey("confirm", email), "attempts")) === "2", "wrong tries are not counted");
  await redis.del(cooldownKey("confirm", email));
  await api("POST", "/auth/resend-confirm-email", { email });
  check((await redis.hGet(otpKey("confirm", email), "attempts")) === "0", "the new code did not reset the tries");
});

await test("the reset code has its own key and expires", async () => {
  const account = await makeAccount();
  await api("POST", "/auth/forgot-password", { email: account.email });
  check((await redis.ttl(otpKey("reset", account.email))) > 0, "no reset code in redis");
  check((await redis.exists(otpKey("confirm", account.email))) === 0, "the confirm code was not deleted");
});

//_________________________________________________________________________________//

print("\n11 - Rate limiting");

env.rateLimitEnabled = true;
await cleanTestRedis(redis, env.redisUri);

await test("login: the 11th try in the window gets 429 with Retry-After, other emails are not blocked", async () => {
  const email = makeEmail("brute");
  for (let i = 0; i < limits.login.max; i++) {
    check((await api("POST", "/auth/login", { email, password: "Wrong0124!" })).status === 401, `try ${i + 1} was blocked`);
  }
  const blocked = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Wrong0124!" }) });
  check(blocked.status === 429 && Number(blocked.headers.get("retry-after")) > 0, `status ${blocked.status}`);
  check((await blocked.json() as { message: string }).message.includes("too many requests"), "wrong message");
  check((await api("POST", "/auth/login", { email: makeEmail("other"), password: "Wrong0124!" })).status === 401, "another email was blocked");
});

await test("the limit is stored in redis with an expiry time", async () => {
  const keys = await redis.keys("rate:login:*");
  check(keys.length > 0, "no limit key in redis");
  const ttl = await redis.ttl(keys[0] as string);
  check(ttl > 0 && ttl <= limits.login.windowSeconds, `ttl is ${ttl}`);
});

await test("register, confirm email, forgot password, reset password and google have limits", async () => {
  await cleanTestRedis(redis, env.redisUri);
  const cases: [string, { max: number }, Plain][] = [
    ["/auth/register", limits.register, {}],
    ["/auth/confirm-email", limits.confirmEmail, { email: makeEmail("cl") }],
    ["/auth/forgot-password", limits.forgotPassword, { email: makeEmail("fl") }],
    ["/auth/reset-password", limits.resetPassword, { email: makeEmail("rl") }],
    ["/auth/resend-confirm-email", limits.resendOtp, { email: makeEmail("sl") }],
    ["/auth/google", limits.google, {}],
  ];
  for (const [path, limit, body] of cases) {
    for (let i = 0; i < limit.max; i++) {
      check((await api("POST", path, body)).status !== 429, `${path} blocked too early`);
    }
    check((await api("POST", path, body)).status === 429, `${path} has no limit`);
  }
});

await test("the global limit protects every route", async () => {
  await cleanTestRedis(redis, env.redisUri);
  const oldMax = limits.global.max;
  limits.global.max = 3;
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    statuses.push((await api("GET", "/")).status);
  }
  limits.global.max = oldMax;
  check(statuses.join() === "200,200,200,429,429", statuses.join());
});

await test("a user is not locked for ever: the limit works again after the window", async () => {
  await cleanTestRedis(redis, env.redisUri);
  const email = makeEmail("window");
  for (let i = 0; i <= limits.login.max; i++) {
    await api("POST", "/auth/login", { email, password: "Wrong0124!" });
  }
  check((await api("POST", "/auth/login", { email, password: "Wrong0124!" })).status === 429, "not blocked");
  const key = (await redis.keys(`rate:login:*${email}`))[0] as string;
  await redis.pExpire(key, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  check((await api("POST", "/auth/login", { email, password: "Wrong0124!" })).status === 401, "still blocked after the window");
});

await test("redis down: the code routes answer 503, the other routes and the login limit keep working", async () => {
  await cleanTestRedis(redis, env.redisUri);
  const account = await makeAccount();
  await disconnectRedis();
  const forgot = await api("POST", "/auth/forgot-password", { email: account.email });
  const profile = await api("GET", "/users/profile", undefined, account.token);
  check(forgot.status === 503, `forgot password gave ${forgot.status}`);
  check(profile.status === 200, `profile gave ${profile.status}`);

  const email = makeEmail("memory");
  for (let i = 0; i < limits.login.max; i++) {
    await api("POST", "/auth/login", { email, password: "Wrong0124!" });
  }
  check((await api("POST", "/auth/login", { email, password: "Wrong0124!" })).status === 429, "no limit while redis is down");
  await connectRedis();
  check((await api("POST", "/auth/forgot-password", { email: account.email })).status === 200, "redis did not come back");
});

env.rateLimitEnabled = false;
await cleanTestRedis(redis, env.redisUri);

//_________________________________________________________________________________//

print("\n12 - Phone encryption (AES-256-GCM)");

await test("encrypt and decrypt: random iv, round trip, tampering is detected", async () => {
  const first = encrypt("01012345678");
  const second = encrypt("01012345678");
  check(first !== second && first.startsWith("enc:v1:") && !first.includes("01012345678"), "not encrypted");
  check(decrypt(first) === "01012345678" && decrypt(encrypt("ملاحظة 🙂")) === "ملاحظة 🙂", "round trip failed");
  const parts = first.split(":");
  const tampered = [...parts.slice(0, 4), (parts[4] as string).replace(/^./, (char) => (char === "a" ? "b" : "a"))].join(":");
  let failed = false;
  try {
    decrypt(tampered);
  } catch {
    failed = true;
  }
  check(failed, "a changed value was accepted");
  check(readPhone(tampered) === null && readPhone("0101") === "0101" && readPhone(undefined) === null, "readPhone is wrong");
});

await test("the phone is saved encrypted in mongodb and the owner sees it decrypted", async () => {
  const email = makeEmail("phone");
  const registered = await api<Plain>("POST", "/auth/register", { ...registerBody(email), phone: "01012345678" });
  check(registered.data.phone === "01012345678", "register did not return the phone");
  const saved = await User.findOne({ email }).lean();
  check(typeof saved?.phone === "string" && saved.phone.startsWith("enc:v1:") && !saved.phone.includes("01012345678"), "phone is not encrypted in the database");
  await api("POST", "/auth/confirm-email", { email, otp: getOtp(email) });
  const login = await loginAgain(email);
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, login.accessToken);
  check(mine.data.profile.phone === "01012345678", "phone is not decrypted");

  const updated = await api<Plain>("PATCH", "/users/profile", { phone: "01199999999" }, login.accessToken);
  check(updated.data.phone === "01199999999", "updated phone is wrong");
  const afterUpdate = await User.findOne({ email }).lean();
  check(afterUpdate?.phone !== saved?.phone && afterUpdate?.phone?.startsWith("enc:v1:") === true, "updated phone is not encrypted");
});

await test("other users, search and admin never get the phone", async () => {
  const owner = await makeAccount("Phoneowner");
  await api("PATCH", "/users/profile", { phone: "01012345678" }, owner.token);
  const viewer = await makeAccount("Phoneviewer");
  const view = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, viewer.token);
  check(!("phone" in view.data.profile), "phone is in the public profile");
  const search = await api<ListData>("GET", "/users/search?q=phoneowner", undefined, viewer.token);
  check(!JSON.stringify(search.data).includes("01012345678"), "phone is in the search");
});

await test("a changed phone value is hidden instead of crashing, and old plain phones still work", async () => {
  const account = await makeAccount("Brokenphone");
  await User.updateOne({ _id: account.id }, { $set: { phone: encrypt("01012345678").slice(0, -2) + "00" } });
  const broken = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(broken.status === 200 && broken.data.profile.phone === null, "broken phone was not hidden");
  await User.updateOne({ _id: account.id }, { $set: { phone: "01234567890" } });
  const plain = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(plain.data.profile.phone === "01234567890", "old plain phone is not readable");
});

await test("the migration encrypts old plain phones, adds the role and can run twice", async () => {
  const account = await makeAccount("Legacy");
  await User.updateOne({ _id: account.id }, { $set: { phone: "01055555555" } });
  await User.collection.updateOne({ _id: new mongoose.Types.ObjectId(account.id) }, { $unset: { role: "" } });

  const first = await migrate();
  check(first.phones >= 1 && first.roles >= 1, `first run: ${JSON.stringify(first)}`);
  const raw = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(account.id) });
  check(typeof raw?.phone === "string" && raw.phone.startsWith("enc:v1:") && raw.role === "user", "user was not migrated");
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(mine.data.profile.phone === "01055555555", "phone is not readable after the migration");
  const second = await migrate();
  check(second.phones === 0 && second.roles === 0, `second run changed data: ${JSON.stringify(second)}`);
});

//_________________________________________________________________________________//

print("\n13 - Profile picture upload (multer)");

const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const gifBytes = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const uploadImage = async (token: string | undefined, content: Buffer, options: { type?: string; name?: string; field?: string } = {}): Promise<ApiResult<Plain>> => {
  const form = new FormData();
  form.append(options.field ?? "image", new Blob([new Uint8Array(content)], { type: options.type ?? "image/png" }), options.name ?? "me.png");
  const response = await fetch(`${baseUrl}/users/profile-picture`, { method: "PATCH", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const json = (await response.json()) as { message: string; data: Plain };
  return { status: response.status, message: json.message, data: json.data };
};

const fileExists = (url: string): Promise<boolean> => {
  return access(join(env.uploadsDir, url.replace("/uploads/", ""))).then(() => true, () => false);
};

await test("a real png is saved with a safe random name and can be opened", async () => {
  const account = await makeAccount();
  const res = await uploadImage(account.token, pngBytes, { name: "../../evil name.png" });
  const url = res.data.profilePicture as string;
  check(res.status === 200 && /^\/uploads\/profile-pictures\/[0-9a-f-]{36}\.png$/.test(url), `status ${res.status}, url ${url}`);
  check(await fileExists(url), "file was not saved");
  const file = await fetch(`${baseUrl}${url}`);
  check(file.status === 200 && file.headers.get("content-type") === "image/png", `opening the file gave ${file.status}`);
  check(file.headers.get("x-content-type-options") === "nosniff", "nosniff is missing");
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(mine.data.profile.profilePicture === url, "the user was not updated");
});

await test("a new picture replaces the old file and remove deletes it", async () => {
  const account = await makeAccount();
  const first = (await uploadImage(account.token, pngBytes)).data.profilePicture as string;
  const second = (await uploadImage(account.token, pngBytes)).data.profilePicture as string;
  check(first !== second && !(await fileExists(first)) && (await fileExists(second)), "the old file was not replaced");
  check((await fetch(`${baseUrl}${first}`)).status === 404, "the old file can still be opened");

  const removed = await api<Plain>("DELETE", "/users/profile-picture", undefined, account.token);
  check(removed.status === 200 && removed.data.profilePicture === null && !(await fileExists(second)), "remove did not delete the file");
});

await test("invalid files are rejected and nothing is saved", async () => {
  const account = await makeAccount();
  const bad: [string, Buffer, { type?: string; name?: string; field?: string }, number][] = [
    ["text with an image name and header", Buffer.from("this is not an image"), { type: "image/png", name: "fake.png" }, 400],
    ["a gif (not allowed)", gifBytes, { type: "image/gif", name: "a.gif" }, 400],
    ["an allowed header but a gif inside", gifBytes, { type: "image/png", name: "a.png" }, 400],
    ["a pdf header", Buffer.from("%PDF-1.4"), { type: "application/pdf", name: "a.pdf" }, 400],
    ["a svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), { type: "image/svg+xml", name: "a.svg" }, 400],
    ["a wrong field name", pngBytes, { field: "avatar" }, 400],
    ["a big file (3 MB)", Buffer.concat([pngBytes, Buffer.alloc(3 * 1024 * 1024)]), {}, 413],
  ];
  for (const [name, content, options, status] of bad) {
    const res = await uploadImage(account.token, content, options);
    check(res.status === status, `${name} gave ${res.status}: ${res.message}`);
  }
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, account.token);
  check(mine.data.profile.profilePicture === null, "an invalid file changed the profile");
  const empty = await api("PATCH", "/users/profile-picture", {}, account.token);
  check(empty.status === 400, `a request without a file gave ${empty.status}`);
});

await test("uploads need a login and every user can change only his own picture", async () => {
  const first = await makeAccount("Pica");
  const second = await makeAccount("Picb");
  check((await uploadImage(undefined, pngBytes)).status === 401, "upload without a token");
  const firstUrl = (await uploadImage(first.token, pngBytes)).data.profilePicture as string;
  await uploadImage(second.token, pngBytes);
  await api("DELETE", "/users/profile-picture", undefined, second.token);
  const view = await api<ProfileData>("GET", `/users/${first.id}`, undefined, second.token);
  check(view.data.profile.profilePicture === firstUrl && (await fileExists(firstUrl)), "another user changed the picture");
  check((await api("DELETE", "/users/profile-picture")).status === 401, "remove without a token");
  check((await api("PATCH", `/users/${first.id}/profile-picture`, {}, second.token)).status === 404, "there is a route with another user id");
});

await test("only the files of this app are deleted: google links, old links and path tricks are safe", async () => {
  const account = await makeAccount();
  const canary = join(env.uploadsDir, "canary.txt");
  await writeFile(canary, "do not delete");

  await User.updateOne({ _id: account.id }, { $set: { profilePicture: "https://lh3.googleusercontent.com/a/p.png" } });
  check((await uploadImage(account.token, pngBytes)).status === 200, "upload over an external link failed");

  await User.updateOne({ _id: account.id }, { $set: { profilePicture: "/uploads/profile-pictures/../canary.txt" } });
  check((await api("DELETE", "/users/profile-picture", undefined, account.token)).status === 200, "remove failed");
  check(await access(canary).then(() => true, () => false), "a file outside the pictures folder was deleted");
});

await test("the uploads folder can't be used to read other files or list the folder", async () => {
  const canary = join(env.uploadsDir, "profile-pictures", "list-me.txt");
  await writeFile(canary, "x").catch(() => undefined);
  const attempts = ["/uploads/..%2fpackage.json", "/uploads/..%2f..%2fpackage.json", "/uploads/%2e%2e%2fpackage.json", "/uploads/profile-pictures/", "/uploads/.env", "/uploads/profile-pictures/..%5c..%5cpackage.json"];
  for (const path of attempts) {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    check(res.status !== 200 || !text.includes("eyad_assignment14"), `${path} gave the file`);
    check(res.status >= 400, `${path} gave ${res.status}`);
  }
});

//_________________________________________________________________________________//

print("\n14 - Roles and admin");

const makeAdminAccount = async (): Promise<Account> => {
  const account = await makeAccount("Admin");
  check(await userRepository.setRole(account.email, "admin"), "could not promote the user");
  return account;
};

await test("every new user is a user, even if the body asks for a role", async () => {
  const email = makeEmail("sneaky");
  const res = await api<Plain>("POST", "/auth/register", { ...registerBody(email), role: "admin", deletedAt: null, isConfirmed: true });
  check(res.status === 201 && res.data.role === "user" && res.data.isConfirmed === false, "extra fields were used");
  check((await User.findOne({ email }))?.role === "user", "role in the database is not user");
});

await test("a user can't change his role by the profile or the settings", async () => {
  const account = await makeAccount();
  check((await api("PATCH", "/users/profile", { role: "admin" }, account.token)).status === 400, "role accepted by the profile");
  check((await api("PATCH", "/users/settings", { isPrivate: false, role: "admin" }, account.token)).status === 400, "role accepted by the settings");
  check((await User.findById(account.id))?.role === "user", "role changed");
});

await test("admin routes: no token 401, normal user 403, a role inside the token is ignored", async () => {
  const user = await makeAccount();
  check((await api("GET", "/admin/users")).status === 401, "no token");
  check((await api("GET", "/admin/users", undefined, user.token)).status === 403, "user got the admin list");
  check((await api("PATCH", `/admin/users/${user.id}/restore`, undefined, user.token)).status === 403, "user could restore");
  const sid = (jwt.decode(user.token) as { sid: string }).sid;
  const forged = jwt.sign({ id: user.id, sid, role: "admin" }, env.accessSecret, { expiresIn: 60 });
  check((await api("GET", "/admin/users", undefined, forged)).status === 403, "a role in the token was trusted");
});

await test("make-admin is the only way to get an admin, and a real admin can list the users", async () => {
  const account = await makeAccount("Script");
  check((await api("GET", "/admin/users", undefined, account.token)).status === 403, "admin before the script");
  const run = promisify(execFile);
  const { stdout } = await run("node", [join(import.meta.dirname, "scripts", "makeAdmin.js"), account.email]);
  check(stdout.includes("is an admin now"), `script output: ${stdout}`);
  const list = await api<{ users: Plain[] } & Plain>("GET", "/admin/users?limit=5", undefined, account.token);
  check(list.status === 200 && list.data.users.length === 5, `list gave ${list.status}`);
  check(!JSON.stringify(list.data).includes("password") && !JSON.stringify(list.data).includes("phone"), "secret fields in the admin list");
  const missing = await run("node", [join(import.meta.dirname, "scripts", "makeAdmin.js"), "nobody@gmail.com"]);
  check(missing.stdout.includes("no confirmed active user"), "unknown email was promoted");
});

//_________________________________________________________________________________//

print("\n15 - Soft delete and restore");

await test("delete account needs the password and keeps the document in the database", async () => {
  const account = await makeAccount();
  check((await api("DELETE", "/users/account", { password: "Wrong0124!" }, account.token)).status === 400, "wrong password accepted");
  check((await api("DELETE", "/users/account", {}, account.token)).status === 400, "no password accepted");
  check((await api("DELETE", "/users/account", undefined, account.token)).status === 400, "no body accepted");
  check((await api("DELETE", "/users/account", { password, extra: 1 }, account.token)).status === 400, "extra field accepted");
  check((await User.findById(account.id))?.deletedAt === undefined, "deleted by a failed request");

  const res = await api("DELETE", "/users/account", { password }, account.token);
  check(res.status === 200, `status ${res.status}`);
  const saved = await User.findById(account.id);
  check(!!saved && saved.deletedAt instanceof Date && saved.email === account.email, "the document is not in the database");
});

await test("a deleted user can't use the old tokens, login, reset the password or register again", async () => {
  const account = await makeAccount();
  const second = await loginAgain(account.email);
  await api("DELETE", "/users/account", { password }, account.token);
  check((await api("GET", "/users/profile", undefined, account.token)).status === 401, "old access token works");
  check((await api("GET", "/users/profile", undefined, second.accessToken)).status === 401, "second session works");
  check((await api("POST", "/auth/refresh-token", { refreshToken: second.refreshToken })).status === 401, "refresh works");
  const login = await api("POST", "/auth/login", { email: account.email, password });
  check(login.status === 403 && login.message.includes("deleted"), `login gave ${login.status}`);
  check((await api("POST", "/auth/login", { email: account.email, password: "Wrong0124!" })).status === 401, "wrong password gave a different answer");
  const before = emailsCount(account.email);
  await api("POST", "/auth/forgot-password", { email: account.email });
  check(emailsCount(account.email) === before, "a deleted user got a reset code");
  check((await api("POST", "/auth/register", registerBody(account.email))).status === 409, "the email was registered again");
});

await test("a deleted google user can't sign in with google", async () => {
  const realVerify = googleAuth.verify;
  googleAuth.verify = async () => ({ email: "google.deleted@gmail.com", firstName: "Del", lastName: "Eted", picture: null });
  const login = await api<LoginData>("POST", "/auth/google", { idToken: "x" });
  check((await api("DELETE", "/users/account", {}, login.data.accessToken)).status === 200, "a google user needs no password");
  const again = await api("POST", "/auth/google", { idToken: "x" });
  googleAuth.verify = realVerify;
  check(again.status === 403, `status ${again.status}`);
});

await test("deleted users disappear from profiles, search, suggestions and lists (the follows are only hidden)", async () => {
  const a = await makeAccount("Dela");
  const b = await makeAccount("Delb");
  const c = await makeAccount("Delc");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  await api("POST", `/users/${a.id}/follow`, undefined, b.token);
  await api("POST", `/users/${c.id}/follow`, undefined, b.token);

  check((await api<ProfileData>("GET", "/users/profile", undefined, a.token)).data.followersCount === 1, "setup is wrong");
  await api("DELETE", "/users/account", { password }, b.token);

  check((await api("GET", `/users/${b.id}`, undefined, a.token)).status === 404, "a deleted profile can be opened");
  check((await api("POST", `/users/${b.id}/follow`, undefined, c.token)).status === 404, "a deleted user can be followed");
  const search = await api<ListData>("GET", "/users/search?q=delb", undefined, a.token);
  check(search.data.total === 0, "a deleted user is in the search");
  const suggestions = await api<ListData>("GET", "/users/suggestions?limit=50", undefined, a.token);
  check(!suggestions.data.users.some((user) => user.id === b.id), "a deleted user is suggested");
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, a.token);
  check(mine.data.followersCount === 0 && mine.data.followingCount === 0, "the counts still include the deleted user");
  const followers = await api<ListData>("GET", `/users/${c.id}/followers`, undefined, a.token);
  check(followers.data.total === 0 && followers.data.users.length === 0, "a deleted follower is in the list");
  const following = await api<ListData>("GET", `/users/${a.id}/following`, undefined, a.token);
  check(following.data.total === 0, "a deleted user is in the following list");
  check((await api("DELETE", `/users/${b.id}/follow`, undefined, a.token)).status === 404, "unfollow works on a hidden follow");
  check((await Follow.countDocuments({ $or: [{ follower: b.id }, { following: b.id }] })) === 3, "the follows were destroyed");
});

await test("only an admin can restore, and then the user, the login and the follows come back", async () => {
  const admin = await makeAdminAccount();
  const a = await makeAccount("Resta");
  const b = await makeAccount("Restb");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  await api("POST", `/users/${a.id}/follow`, undefined, b.token);
  await api("DELETE", "/users/account", { password }, b.token);

  check((await api("PATCH", `/admin/users/${b.id}/restore`)).status === 401, "restore without a token");
  check((await api("PATCH", `/admin/users/${b.id}/restore`, undefined, a.token)).status === 403, "a user restored an account");
  check((await api("PATCH", `/admin/users/${b.id}/restore`, undefined, b.token)).status === 401, "the deleted user restored himself");
  check((await api("POST", "/auth/login", { email: b.email, password })).status === 403, "restored without admin");

  const deletedList = await api<{ users: { id: string; isDeleted: boolean }[] } & Plain>("GET", "/admin/users?status=deleted&limit=50", undefined, admin.token);
  check(deletedList.data.users.some((user) => user.id === b.id && user.isDeleted), "the admin can't see the deleted user");
  const activeList = await api<{ users: { id: string }[] } & Plain>("GET", "/admin/users?status=active&limit=50", undefined, admin.token);
  check(!activeList.data.users.some((user) => user.id === b.id), "a deleted user is in the active list");

  const restored = await api<Plain>("PATCH", `/admin/users/${b.id}/restore`, undefined, admin.token);
  check(restored.status === 200 && restored.data.isDeleted === false, `restore gave ${restored.status}`);
  const login = await loginAgain(b.email);
  const mine = await api<ProfileData>("GET", "/users/profile", undefined, login.accessToken);
  check(mine.data.followersCount === 1 && mine.data.followingCount === 1, "the follows did not come back");
  check((await api<ProfileData>("GET", `/users/${b.id}`, undefined, a.token)).status === 200, "the profile is still hidden");
  check((await api("PATCH", `/admin/users/${b.id}/restore`, undefined, admin.token)).status === 404, "an active user was restored");
  check((await api("PATCH", `/admin/users/${new mongoose.Types.ObjectId().toString()}/restore`, undefined, admin.token)).status === 404, "an unknown user was restored");
  check((await api("PATCH", "/admin/users/123/restore", undefined, admin.token)).status === 400, "a bad id was accepted");
});

await test("when two followers are deleted, a follow comes back only when both are restored", async () => {
  const admin = await makeAdminAccount();
  const a = await makeAccount("Paira");
  const b = await makeAccount("Pairb");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  await api("DELETE", "/users/account", { password }, a.token);
  await api("DELETE", "/users/account", { password }, b.token);
  await api("PATCH", `/admin/users/${a.id}/restore`, undefined, admin.token);
  const first = await api<ProfileData>("GET", "/users/profile", undefined, (await loginAgain(a.email)).accessToken);
  check(first.data.followingCount === 0, "a follow to a deleted user came back");
  await api("PATCH", `/admin/users/${b.id}/restore`, undefined, admin.token);
  const second = await api<ProfileData>("GET", "/users/profile", undefined, (await loginAgain(a.email)).accessToken);
  check(second.data.followingCount === 1, "the follow did not come back");
});

await test("the pending requests of a private account are hidden while the requester is deleted", async () => {
  const admin = await makeAdminAccount();
  const owner = await makeAccount("Reqowner");
  const asker = await makeAccount("Reqasker");
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, asker.token);
  await api("DELETE", "/users/account", { password }, asker.token);
  check((await api<ListData>("GET", "/users/follow-requests", undefined, owner.token)).data.total === 0, "a deleted user has a request");
  check((await api("PATCH", `/users/follow-requests/${asker.id}`, { action: "accept" }, owner.token)).status === 404, "a hidden request was accepted");
  await api("PATCH", `/admin/users/${asker.id}/restore`, undefined, admin.token);
  check((await api<ListData>("GET", "/users/follow-requests", undefined, owner.token)).data.total === 1, "the request did not come back");
});

//_________________________________________________________________________________//

print("\n16 - Pagination");

await test("followers: page metadata, last page, a page after the end and an empty list", async () => {
  const star = await makeAccount("Pagestar");
  const fans = [await makeAccount("Pagefan"), await makeAccount("Pagefan"), await makeAccount("Pagefan"), await makeAccount("Pagefan"), await makeAccount("Pagefan")];
  const empty = await api<ListData>("GET", `/users/${star.id}/followers`, undefined, star.token);
  check(empty.status === 200 && empty.data.total === 0 && empty.data.pages === 0 && empty.data.users.length === 0 && !empty.data.hasNext && !empty.data.hasPrev, "empty list is wrong");

  for (const fan of fans) {
    await api("POST", `/users/${star.id}/follow`, undefined, fan.token);
  }
  const first = await api<ListData>("GET", `/users/${star.id}/followers?limit=2`, undefined, star.token);
  check(first.data.total === 5 && first.data.pages === 3 && first.data.hasNext && !first.data.hasPrev, "first page is wrong");
  const last = await api<ListData>("GET", `/users/${star.id}/followers?limit=2&page=3`, undefined, star.token);
  check(last.data.users.length === 1 && !last.data.hasNext && last.data.hasPrev, "last page is wrong");
  const after = await api<ListData>("GET", `/users/${star.id}/followers?limit=2&page=9`, undefined, star.token);
  check(after.status === 200 && after.data.users.length === 0 && after.data.total === 5, "a page after the end is wrong");
  const ids = new Set([...first.data.users, ...(await api<ListData>("GET", `/users/${star.id}/followers?limit=2&page=2`, undefined, star.token)).data.users, ...last.data.users].map((user) => user.id));
  check(ids.size === 5, "a user is in two pages");
});

await test("the inputs are validated for every list", async () => {
  const account = await makeAccount();
  for (const path of [`/users/${account.id}/followers`, `/users/${account.id}/following`, "/users/search?q=a", "/users/suggestions", "/users/follow-requests"]) {
    const join = path.includes("?") ? "&" : "?";
    for (const bad of ["page=0", "page=-1", "page=abc", "limit=0", "limit=51", "limit=1.5", "limit=1000000"]) {
      check((await api("GET", `${path}${join}${bad}`, undefined, account.token)).status === 400, `${path} accepted ${bad}`);
    }
    check((await api("GET", path, undefined, account.token)).status === 200, `${path} failed with the default values`);
  }
  const defaults = await api<ListData>("GET", `/users/${account.id}/followers`, undefined, account.token);
  check(defaults.data.page === 1 && defaults.data.limit === 10, "wrong default values");
});

await test("the lists of a private account stay private on every page", async () => {
  const owner = await makeAccount("Pagepriv");
  const fan = await makeAccount("Pagefollower");
  const stranger = await makeAccount("Pagestranger");
  await api("POST", `/users/${owner.id}/follow`, undefined, fan.token);
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  for (const path of ["followers", "following", "followers?page=2&limit=1", "followers?page=99"]) {
    check((await api("GET", `/users/${owner.id}/${path}`, undefined, stranger.token)).status === 403, `${path} is open`);
  }
  check((await api("GET", `/users/${owner.id}/followers?page=2&limit=1`, undefined, owner.token)).status === 200, "the owner is blocked");
});

await test("search and suggestions are paginated with the same metadata and no repeated users", async () => {
  const me = await makeAccount("Pagesearcher");
  for (let i = 0; i < 4; i++) {
    await makeAccount("Pagemember");
  }
  const one = await api<ListData>("GET", "/users/search?q=pagemember&limit=3", undefined, me.token);
  const two = await api<ListData>("GET", "/users/search?q=pagemember&limit=3&page=2", undefined, me.token);
  check(one.data.total === 4 && one.data.pages === 2 && one.data.users.length === 3 && two.data.users.length === 1, "search pages are wrong");
  check(one.data.users.every((user) => !two.data.users.some((other) => other.id === user.id)), "search repeats a user");

  const s1 = await api<ListData>("GET", "/users/suggestions?limit=4", undefined, me.token);
  const s2 = await api<ListData>("GET", "/users/suggestions?limit=4&page=2", undefined, me.token);
  check(s1.data.users.length === 4 && s2.data.users.length > 0 && s1.data.total === s2.data.total && s1.data.pages > 1, "suggestion pages are wrong");
  check(s1.data.users.every((user) => !s2.data.users.some((other) => other.id === user.id)), "suggestions repeat a user");
  check(![...s1.data.users, ...s2.data.users].some((user) => user.id === me.id), "I am in my suggestions");
});

await test("suggestions: the mutual follows come first on page 1 and the pages continue with other users", async () => {
  const a = await makeAccount("Mutuala");
  const b = await makeAccount("Mutualb");
  const c = await makeAccount("Mutualc");
  const d = await makeAccount("Mutuald");
  await api("POST", `/users/${b.id}/follow`, undefined, a.token);
  await api("POST", `/users/${c.id}/follow`, undefined, b.token);
  await api("POST", `/users/${d.id}/follow`, undefined, b.token);
  const first = await api<ListData>("GET", "/users/suggestions?limit=1", undefined, a.token);
  const second = await api<ListData>("GET", "/users/suggestions?limit=1&page=2", undefined, a.token);
  const third = await api<ListData>("GET", "/users/suggestions?limit=1&page=3", undefined, a.token);
  const mutual = new Set([c.id, d.id]);
  check(mutual.has(first.data.users[0]?.id as string) && mutual.has(second.data.users[0]?.id as string), "the mutual users are not first");
  check(third.data.users[0] !== undefined && !mutual.has(third.data.users[0].id), "page 3 is not a normal suggestion");
});

await test("admin list is paginated", async () => {
  const admin = await makeAdminAccount();
  const page = await api<ListData>("GET", "/admin/users?limit=2", undefined, admin.token);
  check(page.data.users.length === 2 && page.data.pages > 1 && page.data.hasNext, "admin pages are wrong");
  check((await api("GET", "/admin/users?limit=500", undefined, admin.token)).status === 400, "admin limit is not checked");
  check((await api("GET", "/admin/users?status=banana", undefined, admin.token)).status === 400, "admin status is not checked");
});

//_________________________________________________________________________________//

print("\n17 - Security middleware and headers");

await test("helmet headers are sent and x-powered-by is removed", async () => {
  const res = await fetch(`${baseUrl}/`);
  check(res.headers.get("x-powered-by") === null, "x-powered-by is sent");
  check(res.headers.get("x-content-type-options") === "nosniff", "nosniff is missing");
  check(res.headers.get("x-frame-options") !== null && res.headers.get("strict-transport-security") !== null, "frame or hsts header is missing");
  check(res.headers.get("content-security-policy") !== null, "content security policy is missing");
});

await test("cors: only the allowed origin gets the cors headers", async () => {
  const allowed = await fetch(`${baseUrl}/`, { headers: { Origin: "https://frontend.example.com" } });
  const evil = await fetch(`${baseUrl}/`, { headers: { Origin: "https://evil.example.com" } });
  check(allowed.headers.get("access-control-allow-origin") === "https://frontend.example.com", "the allowed origin has no header");
  check(evil.headers.get("access-control-allow-origin") === null, "an unknown origin is allowed");
  const preflight = await fetch(`${baseUrl}/auth/login`, { method: "OPTIONS", headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" } });
  check(preflight.headers.get("access-control-allow-origin") === null, "preflight allowed an unknown origin");
});

await test("a big body is rejected with a clean error", async () => {
  const res = await api("POST", "/auth/register", { ...registerBody(makeEmail("big")), bio: "x".repeat(20000) });
  check(res.status === 413, `status ${res.status}`);
});

await test("internal errors give a generic message without details", async () => {
  const realVerify = googleAuth.verify;
  const realError = console.error;
  console.error = () => {};
  googleAuth.verify = async () => {
    throw new Error("secret connection string mongodb://user:pass@host");
  };
  const res = await fetch(`${baseUrl}/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: "x" }) });
  const text = await res.text();
  googleAuth.verify = realVerify;
  console.error = realError;
  check(res.status === 500 && text.includes("something went wrong"), `status ${res.status}`);
  check(!text.includes("secret") && !text.includes("mongodb") && !text.includes("stack") && !text.includes("at "), "details leaked");
});

await test("the sensitive routes never answer without authentication", async () => {
  const routes: [string, string][] = [
    ["GET", "/users/profile"], ["PATCH", "/users/profile"], ["PATCH", "/users/profile-picture"], ["DELETE", "/users/profile-picture"],
    ["DELETE", "/users/account"], ["PATCH", "/users/change-password"], ["GET", "/users/settings"], ["PATCH", "/users/settings"],
    ["GET", "/users/search?q=a"], ["GET", "/users/suggestions"], ["GET", "/users/follow-requests"], ["GET", "/admin/users"],
    ["POST", "/auth/logout"], ["POST", "/auth/logout-all"],
  ];
  for (const [method, path] of routes) {
    check((await api(method, path)).status === 401, `${method} ${path} is open`);
  }
});

//_________________________________________________________________________________//

print("\n18 - Redis availability (real app processes, real redis servers)");

const redisBin = process.env.REDIS_SERVER_BIN ?? "redis-server";
const hasRedisServer = await promisify(execFile)(redisBin, ["--version"]).then(() => true, () => false);

const waitFor = async (condition: () => Promise<boolean>, timeout: number = 20000): Promise<boolean> => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition().catch(() => false)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

const getFreePort = (): Promise<number> => {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
};

interface RunningApp {
  url: string;
  output: () => string;
  stop: () => Promise<number | null>;
}

//starts the real app (dist/main.js) like npm start does
const startApp = async (redisPort: number, extraEnv: Record<string, string> = {}): Promise<RunningApp> => {
  const port = await getFreePort();
  const child = spawn("node", [join(import.meta.dirname, "main.js")], {
    env: { ...process.env, PORT: String(port), REDIS_URI: `redis://127.0.0.1:${redisPort}`, ...extraEnv },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const url = `http://127.0.0.1:${port}`;
  const started = await waitFor(async () => (await fetch(`${url}/`)).status === 200, 15000);
  if (!started) {
    child.kill("SIGKILL");
    throw new Error(`the app did not start: ${output}`);
  }
  return {
    url,
    output: () => output,
    stop: () => new Promise((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.kill("SIGTERM");
    }),
  };
};

const call = async <T = Plain>(running: RunningApp, method: string, path: string, body?: unknown, token?: string): Promise<ApiResult<T>> => {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${running.url}${path}`, init);
  const json = (await response.json()) as { message: string; data: T };
  return { status: response.status, message: json.message, data: json.data };
};

//a throwaway redis server for one scenario
const startRedisServer = async (port: number): Promise<ChildProcess> => {
  const child = spawn(redisBin, ["--port", String(port), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const up = await waitFor(() => new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  }), 10000);
  if (!up) {
    child.kill("SIGKILL");
    throw new Error("the test redis server did not start");
  }
  return child;
};

const stopRedisServer = (child: ChildProcess): Promise<void> => {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
};

const closedPort = await getFreePort();

await test("startup without redis: the server starts, the normal routes work and the code routes answer 503", async () => {
  const running = await startApp(closedPort);
  try {
    const account = await makeAccount("Noredis");
    const email = makeEmail("noredisreg");
    const login = await call<LoginData>(running, "POST", "/auth/login", { email: account.email, password });
    check(login.status === 200, `login gave ${login.status}`);
    check((await call(running, "GET", "/users/profile", undefined, login.data.accessToken)).status === 200, "profile does not work");
    check((await call(running, "GET", `/users/search?q=noredis`, undefined, login.data.accessToken)).status === 200, "search does not work");

    const register = await call(running, "POST", "/auth/register", registerBody(email));
    check(register.status === 503, `register gave ${register.status}`);
    check((await User.countDocuments({ email })) === 0, "register created a user without a code");

    const known = await call(running, "POST", "/auth/forgot-password", { email: account.email });
    const unknown = await call(running, "POST", "/auth/forgot-password", { email: makeEmail("ghost") });
    check(known.status === 503 && unknown.status === 503 && known.message === unknown.message, "forgot password answers are different");
    check((await call(running, "POST", "/auth/resend-confirm-email", { email: account.email })).status === 503, "resend gave a success");
    check((await call(running, "POST", "/auth/confirm-email", { email: account.email, otp: "123456" })).status === 503, "confirm gave another answer");
    check((await call(running, "POST", "/auth/reset-password", { email: account.email, otp: "123456", newPassword: "NewPass0124!" })).status === 503, "reset gave another answer");
    check(!running.output().includes("code for"), "a code was generated without redis");
  } finally {
    check((await running.stop()) === 0, "the app did not stop cleanly");
  }
});

await test("startup without redis: the rate limits still work (memory fallback)", async () => {
  const running = await startApp(closedPort, { RATE_LIMIT_ENABLED: "true" });
  try {
    const email = makeEmail("fallback");
    const statuses: number[] = [];
    for (let i = 0; i <= limits.login.max; i++) {
      statuses.push((await call(running, "POST", "/auth/login", { email, password: "Wrong0124!" })).status);
    }
    check(statuses.slice(0, -1).every((status) => status === 401) && statuses.at(-1) === 429, statuses.join());
  } finally {
    await running.stop();
  }
});

if (hasRedisServer) {
  await test("redis comes after the startup, goes away at runtime and comes back, without restarting the app", async () => {
    const redisPort = await getFreePort();
    const running = await startApp(redisPort);
    let server: ChildProcess | null = null;
    try {
      const account = await makeAccount("Recover");
      const forgot = () => call(running, "POST", "/auth/forgot-password", { email: account.email });
      check((await forgot()).status === 503, "redis was not down at the start");

      server = await startRedisServer(redisPort);
      check(await waitFor(async () => (await forgot()).status === 200), "the app did not recover when redis came");
      const otp = new RegExp(`Reset your password code for ${account.email} : (\\d{6})`).exec(running.output())?.[1];
      check(!!otp, "no code was generated");
      const newPassword = "NewPass0124!";
      check((await call(running, "POST", "/auth/reset-password", { email: account.email, otp, newPassword })).status === 200, "the code did not work after the recovery");
      await loginAgain(account.email, newPassword);

      await stopRedisServer(server);
      server = null;
      check(await waitFor(async () => (await forgot()).status === 503), "the app did not notice that redis stopped");
      const login = await call<LoginData>(running, "POST", "/auth/login", { email: account.email, password: newPassword });
      check(login.status === 200 && (await call(running, "GET", "/users/profile", undefined, login.data.accessToken)).status === 200, "normal routes failed while redis was down");

      server = await startRedisServer(redisPort);
      check(await waitFor(async () => (await forgot()).status === 200), "the app did not recover the second time");
    } finally {
      if (server) {
        await stopRedisServer(server);
      }
      await running.stop();
    }
  });
} else {
  skip("redis comes after the startup, goes away at runtime and comes back", `no ${redisBin} binary, set REDIS_SERVER_BIN`);
}

//makes one redis command fail like a lost connection, returns the function that puts it back
const stubRedis = (name: "hGet" | "multi"): (() => void) => {
  const own = Object.getOwnPropertyDescriptor(redis, name);
  Object.defineProperty(redis, name, {
    configurable: true,
    writable: true,
    value: () => {
      throw new Error("connection lost");
    },
  });
  return () => {
    if (own) {
      Object.defineProperty(redis, name, own);
    } else {
      Reflect.deleteProperty(redis, name);
    }
  };
};

await test("a redis command that fails during an OTP operation gives 503 and nothing is created, used or consumed (stubbed command)", async () => {
  const account = await makeAccount("Stubbed");
  const email = makeEmail("stubbedreg");
  await api("POST", "/auth/register", registerBody(email));
  const otp = getOtp(email);
  const before = emailsCount(email);

  const restoreHGet = stubRedis("hGet");
  const confirm = await api("POST", "/auth/confirm-email", { email, otp });
  restoreHGet();
  check(confirm.status === 503, `confirm gave ${confirm.status}`);
  check((await User.findOne({ email }))?.isConfirmed === false, "the email was confirmed without redis");
  check((await redis.exists(otpKey("confirm", email))) === 1, "the code was consumed by a failed operation");

  await redis.del(cooldownKey("reset", account.email));
  const restoreMulti = stubRedis("multi");
  const forgot = await api("POST", "/auth/forgot-password", { email: account.email });
  restoreMulti();
  check(forgot.status === 503, `forgot gave ${forgot.status}`);
  check(emailsCount(account.email) === 1 && (await redis.exists(cooldownKey("reset", account.email))) === 0, "an email was sent or the user is blocked after a failure");
  check((await api("POST", "/auth/forgot-password", { email: account.email })).status === 200 && emailsCount(account.email) === 2, "the user can't try again");

  check((await api("POST", "/auth/confirm-email", { email, otp })).status === 200, "the code does not work after the failure");
  check(before === emailsCount(email), "an email was sent by a failed operation");
});

//_________________________________________________________________________________//

print("\n19 - Test redis safety guard");

const redisPort = checkRedisUri(env.redisUri).port;

//unique key names, so a test never touches a key that existed before
const unique = (prefix: string): string => `${prefix}-${randomBytes(6).toString("hex")}`;

//a real client on the local database 13 or 14, used only if the database is empty (or has only the test mark), otherwise the test is skipped
//at the end it deletes only the keys of the test and a mark that the test created, a mark that existed before is never touched
const withRedisDb = async (db: number, needsEmpty: boolean, run: (client: typeof redis, uri: string, keys: string[]) => Promise<void>): Promise<void> => {
  const uri = `redis://127.0.0.1:${redisPort}/${db}`;
  const client = createClient({ url: uri });
  client.on("error", () => {});
  await client.connect();
  try {
    const size = await client.dbSize();
    const hadMark = size === 1 && (await client.get(sentinelKey)) === "yes";
    if (size !== 0 && (needsEmpty || !hadMark)) {
      throw new SkipTest(`database ${db} has other data, it was left untouched`);
    }
    const keys: string[] = [];
    try {
      await run(client, uri, keys);
    } finally {
      if (keys.length > 0) {
        await client.del(keys);
      }
      if (!hadMark && (await client.get(sentinelKey)) === "yes") {
        await client.del(sentinelKey);
      }
    }
    check((await client.dbSize()) === size && ((await client.get(sentinelKey)) === "yes") === hadMark, `database ${db} was not left as it was found`);
  } finally {
    await client.close();
  }
};

await test("the default test configuration and a safe custom configuration are accepted", async () => {
  checkRedisUri(env.redisUri);
  checkRedisUri("redis://localhost:6380/3");
  await verifyTestRedis(redis, env.redisUri);
  await withRedisDb(13, false, async (client, uri, keys) => {
    const key = unique("otp:custom");
    keys.push(key);
    await verifyTestRedis(client, uri);
    await client.set(key, "x");
    await cleanTestRedis(client, uri);
    check((await client.exists(key)) === 0, "the custom test database was not cleaned");
  });
});

await test("production-like and invalid redis addresses are rejected before connecting", async () => {
  const bad = [
    "", "not a uri", "redis://prod-redis.example.com:6379/15", "redis://10.0.0.5:6379/15", "rediss://127.0.0.1:6379/15",
    "redis://user:secret@127.0.0.1:6379/15", "redis://:secret@127.0.0.1:6379/15", "redis://127.0.0.1:6379", "redis://127.0.0.1:6379/0",
    "redis://127.0.0.1:6379/16", "redis://127.0.0.1:6379/abc", "redis://127.0.0.1.example.com:6379/15",
  ];
  for (const uri of bad) {
    let rejected = false;
    try {
      checkRedisUri(uri);
    } catch (error) {
      rejected = !(error as Error).message.includes("secret");
    }
    check(rejected, `${uri || "(empty)"} was accepted or the error showed the password`);
  }
});

await test("a database with other data that is not marked as a test database is refused and nothing is deleted", async () => {
  await withRedisDb(14, true, async (client, uri, keys) => {
    const foreign = [unique("otp:foreign"), unique("user:session")];
    keys.push(...foreign);
    for (const key of foreign) {
      await client.set(key, "real data");
    }
    let verified = false;
    let cleaned = false;
    await verifyTestRedis(client, uri).then(() => (verified = true), () => undefined);
    await cleanTestRedis(client, uri).then(() => (cleaned = true), () => undefined);
    check(!verified && !cleaned, "an unverified database was accepted");
    for (const key of foreign) {
      check((await client.get(key)) === "real data", "data was deleted after the validation failed");
    }
    check((await client.get(sentinelKey)) === null, "an unverified database was marked");
  });
});

await test("a marked test database loses only the keys of the app", async () => {
  await withRedisDb(13, false, async (client, uri, keys) => {
    const owned = [unique("otp:a"), unique("otp-cooldown:a"), unique("rate:a")];
    const other = unique("keep:me");
    keys.push(...owned, other);
    await verifyTestRedis(client, uri);
    for (const key of [...owned, other]) {
      await client.set(key, "x");
    }
    await cleanTestRedis(client, uri);
    check((await client.exists(owned)) === 0, "the keys of the app were not deleted");
    check((await client.get(other)) === "x", "another key was deleted");
  });
});

await test("the cleanup refuses to run outside the test run, in production mode or on the wrong database", async () => {
  const key = unique("otp:guard");
  await redis.set(key, "x");
  const marker = process.env.SOCIAL_APP_TEST_RUN;
  const mode = process.env.NODE_ENV;
  const attempts: [string, () => Promise<void>][] = [
    ["without the marker", async () => {
      delete process.env.SOCIAL_APP_TEST_RUN;
      await cleanTestRedis(redis, env.redisUri);
    }],
    ["in production mode", async () => {
      process.env.NODE_ENV = "production";
      await cleanTestRedis(redis, env.redisUri);
    }],
    ["on another database than the uri", () => cleanTestRedis(redis, `redis://127.0.0.1:${redisPort}/14`)],
    ["with a remote uri", () => cleanTestRedis(redis, "redis://prod-redis.example.com:6379/15")],
  ];
  try {
    for (const [name, attempt] of attempts) {
      let refused = false;
      await attempt().catch(() => (refused = true));
      process.env.SOCIAL_APP_TEST_RUN = marker as string;
      process.env.NODE_ENV = mode as string;
      check(refused, `the cleanup ran ${name}`);
      check((await redis.get(key)) === "x", `data was deleted ${name}`);
    }
  } finally {
    await redis.del(key);
  }
});

await test("a mark that existed before is never deleted, by the cleanup or by the test helper", async () => {
  await withRedisDb(13, true, async (client, uri, keys) => {
    const mine = unique("otp:mine");
    const other = unique("keep:other");
    keys.push(mine, other);
    await client.set(sentinelKey, "yes");
    await client.set(mine, "x");
    await client.set(other, "x");
    await cleanTestRedis(client, uri);
    check((await client.get(sentinelKey)) === "yes", "the cleanup deleted the mark");
    check((await client.exists(mine)) === 0 && (await client.get(other)) === "x", "the cleanup deleted the wrong keys");
    await client.del([mine, other]);

    //the database now has only the mark, like a database marked by an earlier run
    let ran = false;
    await withRedisDb(13, false, async (second, secondUri, secondKeys) => {
      ran = true;
      const own = unique("otp:second");
      secondKeys.push(own);
      await second.set(own, "x");
      await cleanTestRedis(second, secondUri);
    });
    check(ran && (await client.get(sentinelKey)) === "yes" && (await client.dbSize()) === 1, "the helper changed a database that had only the mark");
  });
});

await test("a database with unexpected data is skipped by the helper and not modified", async () => {
  await withRedisDb(14, true, async (client, uri, keys) => {
    const unexpected = unique("keep:unexpected");
    keys.push(unexpected);
    await client.set(unexpected, "real data");
    let result = "ran";
    await withRedisDb(14, false, async () => undefined).catch((error: unknown) => (result = error instanceof SkipTest ? "skipped" : "error"));
    check(result === "skipped", `the helper did not skip: ${result}`);
    await cleanTestRedis(client, uri).catch(() => undefined);
    check((await client.get(unexpected)) === "real data" && (await client.dbSize()) === 1, "unexpected data was modified");
  });
});

await test("no code of the project flushes a redis database", async () => {
  const flush = new RegExp("\\.flush" + "(db|all)\\s*\\(", "i");
  const files = (await readdir(import.meta.dirname, { recursive: true })).filter((file) => file.endsWith(".js"));
  check(files.length > 20, "the build files were not found");
  for (const file of files) {
    check(!flush.test(await readFile(join(import.meta.dirname, file), "utf8")), `${file} flushes a redis database`);
  }
});

//_________________________________________________________________________________//

print("\n20 - Regression: deleted and restored accounts");

await test("after a delete and a restore the old refresh and access tokens stay dead, a new login works", async () => {
  const admin = await makeAdminAccount();
  const account = await makeAccount("Tokens");
  await api("DELETE", "/users/account", { password }, account.token);
  check((await api("POST", "/auth/refresh-token", { refreshToken: account.refreshToken })).status === 401, "refresh works after the delete");
  await api("PATCH", `/admin/users/${account.id}/restore`, undefined, admin.token);
  check((await api("POST", "/auth/refresh-token", { refreshToken: account.refreshToken })).status === 401, "an old refresh token works after the restore");
  check((await api("GET", "/users/profile", undefined, account.token)).status === 401, "an old access token works after the restore");
  const login = await loginAgain(account.email);
  check((await api("GET", "/users/profile", undefined, login.accessToken)).status === 200, "the new login does not work");
});

await test("a refresh token of a deleted user is refused even if its session was not removed", async () => {
  const account = await makeAccount("Orphan");
  await User.updateOne({ _id: account.id }, { $set: { deletedAt: new Date() } });
  const res = await api("POST", "/auth/refresh-token", { refreshToken: account.refreshToken });
  check(res.status === 401 && (await Session.countDocuments({ userId: account.id })) === 0, `status ${res.status}`);
});

await test("a restored private account stays private: strangers see the limited profile, old followers still see everything", async () => {
  const admin = await makeAdminAccount();
  const owner = await makeAccount("Restpriv");
  const follower = await makeAccount("Restfollower");
  const stranger = await makeAccount("Reststranger");
  await api("PATCH", "/users/profile", { bio: "private bio" }, owner.token);
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, follower.token);
  await api("PATCH", `/users/follow-requests/${follower.id}`, { action: "accept" }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, stranger.token);

  await api("DELETE", "/users/account", { password }, owner.token);
  await api("PATCH", `/admin/users/${owner.id}/restore`, undefined, admin.token);

  const strangerView = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, stranger.token);
  check(strangerView.data.canViewProfile === false && !("bio" in strangerView.data.profile) && strangerView.data.followStatus === "pending", "a stranger sees a restored private profile");
  const followerView = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, follower.token);
  check(followerView.data.canViewProfile === true && followerView.data.profile.bio === "private bio", "an old follower lost the access");
  const login = await loginAgain(owner.email);
  const settings = await api<{ isPrivate: boolean }>("GET", "/users/settings", undefined, login.accessToken);
  check(settings.data.isPrivate === true, "the account became public");
  check((await api<ListData>("GET", "/users/follow-requests", undefined, login.accessToken)).data.total === 1, "the pending request was lost");
});

await test("a request of a deleted user is accepted when the account becomes public, and nothing is visible before the restore", async () => {
  const admin = await makeAdminAccount();
  const owner = await makeAccount("Pubswitch");
  const asker = await makeAccount("Pubasker");
  await api("PATCH", "/users/settings", { isPrivate: true }, owner.token);
  await api("POST", `/users/${owner.id}/follow`, undefined, asker.token);
  await api("DELETE", "/users/account", { password }, asker.token);
  await api("PATCH", "/users/settings", { isPrivate: false }, owner.token);
  check((await api<ProfileData>("GET", "/users/profile", undefined, owner.token)).data.followersCount === 0, "a deleted follower is counted");
  await api("PATCH", `/admin/users/${asker.id}/restore`, undefined, admin.token);
  const view = await api<ProfileData>("GET", `/users/${owner.id}`, undefined, (await loginAgain(asker.email)).accessToken);
  check(view.data.followStatus === "following" && view.data.canViewProfile === true, "the request stayed pending on a public account");
});

//_________________________________________________________________________________//

print("\n21 - Test mongodb safety guard");

await test("remote, credential and unsafe-name mongodb addresses are rejected", async () => {
  const bad = [
    "", "not a uri", "http://127.0.0.1:27017/app_test",
    "mongodb://127.0.0.1:27017/contest", "mongodb://127.0.0.1:27017/test", "mongodb://127.0.0.1:27017/_test", "mongodb://127.0.0.1:27017/social_app",
    "mongodb://127.0.0.1:27017/social_app_testing", "mongodb://127.0.0.1:27017/app_test_backup", "mongodb://127.0.0.1:27017/app_test/extra", "mongodb://127.0.0.1:27017",
    "mongodb://db.prod.example.com:27017/app_test", "mongodb://10.0.0.5:27017/app_test", "mongodb://127.0.0.1.example.com:27017/app_test",
    "mongodb+srv://cluster0.abc.mongodb.net/app_test", "mongodb+srv://127.0.0.1/app_test",
    "mongodb://admin:secret@127.0.0.1:27017/app_test", "mongodb://:secret@127.0.0.1:27017/app_test",
    "mongodb://127.0.0.1:27017,db.prod.example.com:27017/app_test", "mongodb://127.0.0.1:27017/app_test?authSource=admin",
  ];
  for (const uri of bad) {
    let rejected = false;
    try {
      checkMongoUri(uri);
    } catch (error) {
      rejected = !(error as Error).message.includes("secret");
    }
    check(rejected, `${uri || "(empty)"} was accepted or the error showed the password`);
  }
});

await test("a dedicated local test database is accepted (also with TEST_MONGO_URI)", async () => {
  const good: [string, string][] = [
    ["mongodb://127.0.0.1:27017/social_app_test", "social_app_test"],
    ["mongodb://localhost:27017/my-app_test", "my-app_test"],
    ["mongodb://[::1]:27017/x_test", "x_test"],
    ["mongodb://127.0.0.1/social_app_test?directConnection=true", "social_app_test"],
  ];
  for (const [uri, db] of good) {
    check(checkMongoUri(uri).db === db, `${uri} was not accepted`);
  }
  check(checkMongoUri(env.mongoUri).db.endsWith("_test"), "the uri of this run is not a test database");
});

await test("the real connection is checked again before dropDatabase (name and host)", async () => {
  verifyTestMongo(mongoose.connection.name, mongoose.connection.host);
  const bad: [string, string][] = [["contest", "127.0.0.1"], ["social_app", "127.0.0.1"], ["app_testing", "127.0.0.1"], ["_test", "localhost"], ["app_test", "db.prod.example.com"], ["app_test", "10.0.0.5"]];
  for (const [name, host] of bad) {
    let rejected = false;
    try {
      verifyTestMongo(name, host);
    } catch {
      rejected = true;
    }
    check(rejected, `${name} on ${host} was accepted`);
  }
});

await test("an unsafe TEST_MONGO_URI stops the test run before any connection or drop (real child process)", async () => {
  const run = promisify(execFile);
  const probeName = `contest${randomBytes(6).toString("hex")}`;
  const probe = mongoose.connection.getClient().db(probeName);
  await probe.collection("canary").insertOne({ keep: "me" });
  const cases: [string, string][] = [
    ["a name that only contains test", `mongodb://127.0.0.1:27017/${probeName}`],
    ["a name that does not end with _test", `mongodb://127.0.0.1:27017/${probeName}_testing`],
    ["a remote host", "mongodb://db.prod.example.com:27017/app_test"],
    ["credentials", "mongodb://admin:hunter2@127.0.0.1:27017/app_test"],
    ["mongodb+srv", "mongodb+srv://cluster0.abc.mongodb.net/app_test"],
  ];
  try {
    for (const [name, uri] of cases) {
      const started = Date.now();
      const result = await run(process.execPath, [join(import.meta.dirname, "test.js")], { env: { ...process.env, TEST_MONGO_URI: uri }, timeout: 60000 }).then(
        () => ({ code: 0, out: "" }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` })
      );
      check(result.code !== 0 && result.out.includes("the test mongodb"), `${name}: the run was not stopped by the guard: ${result.out.slice(0, 200)}`);
      check(!result.out.includes("hunter2") && !result.out.includes("database connected") && !result.out.includes("PASS"), `${name}: the run went on or showed the password`);
      check(Date.now() - started < 30000, `${name}: the guard was too slow, it may have tried to connect`);
    }
    check((await probe.collection("canary").countDocuments({ keep: "me" })) === 1, "the data of the unsafe database was dropped");
  } finally {
    await probe.dropDatabase();
  }
});

//_________________________________________________________________________________//

server.close();
await disconnectRedis();
await mongoose.disconnect();

print(`\nResult: ${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) {
  throw new Error(`${failed} test(s) failed`);
}
