import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";
import { RefreshSession, User } from "./models.js";

export type AuthedRequest = Request & { userId?: string };
export const digest = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
export async function tokens(userId: string) {
  const owner = await User.findOne({
    _id: userId,
    status: "active",
    adminRole: null,
  });
  if (!owner)
    throw Object.assign(new Error("Account unavailable."), { status: 401 });
  if (!config.JWT_SECRET)
    throw Object.assign(new Error("Authentication is not configured."), {
      status: 503,
    });
  const accessToken = jwt.sign(
    { sub: userId, sv: owner.sessionVersion ?? 0 },
    config.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "15m",
      issuer: "along",
      audience: "along-mobile",
    },
  );
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  await RefreshSession.create({
    user: userId,
    tokenHash: digest(refreshToken),
    expiresAt: new Date(Date.now() + 30 * 86400000),
  });
  return { accessToken, refreshToken, expiresIn: 900 };
}
export async function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  if (!config.JWT_SECRET) {
    res.status(503).json({
      error: {
        code: "AUTH_UNCONFIGURED",
        message: "Set JWT_SECRET on the API server.",
      },
    });
    return;
  }
  try {
    const raw = req.headers.authorization;
    if (!raw?.startsWith("Bearer ")) throw new Error();
    const user = await verifyMemberToken(raw.slice(7));
    if (!user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > 60000)
      await User.updateOne({ _id: user._id }, { lastActiveAt: new Date() });
    req.userId = String(user._id);
    next();
  } catch {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Please sign in again." },
    });
  }
}
/** Shared by HTTP and game sockets; revoked sessions are checked on every event. */
export async function verifyMemberToken(token: string) {
  if (!config.JWT_SECRET) throw new Error("Authentication unavailable.");
  const payload = jwt.verify(token, config.JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: "along",
    audience: "along-mobile",
  });
  if (typeof payload === "string" || !payload.sub) throw new Error();
  const user = await User.findOne({
    _id: payload.sub,
    status: "active",
    adminRole: null,
  });
  if (!user || (payload.sv ?? 0) !== (user.sessionVersion ?? 0))
    throw new Error();
  return user;
}
