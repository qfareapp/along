import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import * as OTPAuth from "otpauth";
import { User } from "../models.js";
import { config } from "../config.js";
import { digest } from "../auth.js";
import { AdminRole, AdminSession, AuditLog } from "./models.js";
import type { Permission } from "./permissions.js";

export const adminCookie = "along_admin";
export function environmentCredentialVersion() {
  return crypto
    .createHmac("sha256", config.JWT_SECRET!)
    .update(config.ADMIN_EMAIL!)
    .update("\0")
    .update(config.ADMIN_PASSWORD!)
    .digest("hex");
}
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export type AdminRequest = Request & {
  admin?: {
    id: string;
    name: string;
    email: string;
    role: string;
    permissions: string[];
    authMode?: "mfa" | "env";
  };
  session?: { id: string; csrf: string };
  requestId?: string;
};
export function encryptSecret(secret: string) {
  if (!config.ADMIN_ENCRYPTION_KEY)
    throw fail(
      503,
      "Configure ADMIN_ENCRYPTION_KEY before provisioning admins.",
    );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(config.ADMIN_ENCRYPTION_KEY, "hex"),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}
export function decryptSecret(encrypted: string) {
  if (!config.ADMIN_ENCRYPTION_KEY)
    throw fail(503, "Administrative MFA is not configured.");
  const data = Buffer.from(encrypted, "base64url");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(config.ADMIN_ENCRYPTION_KEY, "hex"),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export const totpFor = (secret: string, email = "admin") =>
  new OTPAuth.TOTP({
    issuer: "Along Admin",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
export function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function requireOrigin(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (req.headers.origin !== new URL(config.ADMIN_ORIGIN).origin)
    throw fail(403, "Request origin is not allowed.");
  next();
}
export async function audit(
  req: AdminRequest,
  action: string,
  targetType: string,
  targetId: string,
  reason?: string,
  metadata?: Record<string, unknown>,
  outcome = "success",
) {
  return AuditLog.create({
    admin: req.admin?.id,
    action,
    targetType,
    targetId,
    reason,
    metadata,
    outcome,
    requestId: req.requestId,
  });
}
export async function adminAuth(
  req: AdminRequest,
  res: Response,
  next: NextFunction,
) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? "").split(";").map((v) => v.trim().split("=")),
  );
  const token = cookies[adminCookie];
  if (!token || !/^[a-zA-Z0-9_-]{64}$/.test(token))
    throw fail(401, "Sign in to Along Admin.");
  const session = await AdminSession.findOne({
    tokenHash: digest(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    lastSeenAt: { $gt: new Date(Date.now() - 30 * 60000) },
  });
  if (!session) throw fail(401, "Your session has expired. Sign in again.");
  if (
    (session.authMode ?? "mfa") !== config.ADMIN_AUTH_MODE ||
    (config.ADMIN_AUTH_MODE === "env" &&
      !same(session.credentialVersion ?? "", environmentCredentialVersion()))
  )
    throw fail(401, "Login settings changed. Sign in again.");
  const user = await User.findOne({
    _id: session.user,
    status: "active",
    adminRole: { $ne: null },
  });
  const role = user && (await AdminRole.findOne({ slug: user.adminRole }));
  if (!user || !role) throw fail(401, "Administrative access is unavailable.");
  if (config.ADMIN_AUTH_MODE === "env" && user.email !== config.ADMIN_EMAIL)
    throw fail(401, "Login settings changed. Sign in again.");
  req.admin = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: role.slug,
    permissions: role.permissions,
    authMode: config.ADMIN_AUTH_MODE,
  };
  req.session = { id: String(session._id), csrf: session.csrf };
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (
      req.headers.origin !== new URL(config.ADMIN_ORIGIN).origin ||
      !same(String(req.headers["x-csrf-token"] ?? ""), session.csrf)
    )
      throw fail(403, "CSRF validation failed. Reload and try again.");
  }
  if (Date.now() - session.lastSeenAt.getTime() > 60000)
    await AdminSession.updateOne(
      { _id: session._id },
      { lastSeenAt: new Date() },
    );
  res.setHeader("Cache-Control", "no-store");
  next();
}
export const permit =
  (permission: Permission) =>
  async (req: AdminRequest, _res: Response, next: NextFunction) => {
    if (!req.admin?.permissions.includes(permission)) {
      await audit(
        req,
        "access.denied",
        "permission",
        permission,
        undefined,
        undefined,
        "denied",
      );
      throw fail(403, "Your role does not permit this action.");
    }
    next();
  };
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 8 * 3600000,
  };
}
