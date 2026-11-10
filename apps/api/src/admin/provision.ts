import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models.js";
import { AdminRole, AuditLog, PlatformSetting } from "./models.js";
import { encryptSecret } from "./security.js";
import { digest } from "../auth.js";
import { seedRoles } from "./permissions.js";

export const strongPassword = z
  .string()
  .min(6)
  .max(72)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^a-zA-Z0-9]/);
export async function provisionFirstAdmin(
  email: string,
  password: string,
  name: string,
) {
  z.email().parse(email);
  strongPassword.parse(password);
  z.string().trim().min(2).max(60).parse(name);
  await seedRoles();
  await PlatformSetting.init();
  // Unique singleton claim prevents concurrent bootstrap processes from creating two initial admins.
  const claim = await PlatformSetting.findOneAndUpdate(
    { key: "admin-bootstrap" },
    { $setOnInsert: { value: { state: "claimed" } } },
    { upsert: true, new: false },
  );
  if (claim || (await User.exists({ adminRole: { $ne: null } })))
    throw new Error(
      "Admin bootstrap is already claimed. Use the existing admin recovery process.",
    );
  try {
    const { Secret } = await import("otpauth");
    const secret = new Secret({ size: 20 }).base32;
    const recoveryCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(12).toString("hex"),
    );
    const user = await User.create({
      email: email.toLowerCase(),
      name,
      passwordHash: await bcrypt.hash(password, 12),
      adminRole: "super-admin",
      emailVerified: true,
      mfaSecretEncrypted: encryptSecret(secret),
      recoveryHashes: recoveryCodes.map(digest),
    });
    await AuditLog.create({
      admin: user._id,
      action: "admin.bootstrap",
      targetType: "User",
      targetId: String(user._id),
      reason: "One-time operator bootstrap",
    });
    await PlatformSetting.updateOne(
      { key: "admin-bootstrap" },
      { value: { state: "complete" } },
    );
    return { user, secret, recoveryCodes };
  } catch (error) {
    // Only release the claim when no admin account was created; never reopen a completed bootstrap.
    if (!(await User.exists({ adminRole: { $ne: null } })))
      await PlatformSetting.deleteOne({
        key: "admin-bootstrap",
        "value.state": "claimed",
      });
    throw error;
  }
}
