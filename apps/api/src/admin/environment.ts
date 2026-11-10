import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { digest } from "../auth.js";
import { User } from "../models.js";
import { seedRoles } from "./permissions.js";
import { AuditLog } from "./models.js";
import { same, fail } from "./security.js";

export function matchesEnvironmentCredentials(email: string, password: string) {
  return (
    same(digest(email.toLowerCase()), digest(config.ADMIN_EMAIL!)) &&
    same(digest(password), digest(config.ADMIN_PASSWORD!))
  );
}
export async function ensureEnvironmentAdmin() {
  await seedRoles();
  let user = await User.findOne({ email: config.ADMIN_EMAIL });
  if (user && !user.adminRole)
    throw fail(
      409,
      "This email belongs to a mobile account. Choose a separate ADMIN_EMAIL in the backend environment file.",
    );
  if (!user) {
    try {
      user = await User.create({
        email: config.ADMIN_EMAIL,
        name: config.ADMIN_NAME,
        adminRole: "super-admin",
        passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD!, 12),
        emailVerified: true,
      });
      await AuditLog.create({
        admin: user._id,
        action: "admin.environment_provisioned",
        targetType: "User",
        targetId: String(user._id),
        reason: "Operator enabled temporary environment-based admin login.",
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      user = await User.findOne({ email: config.ADMIN_EMAIL });
      if (!user?.adminRole)
        throw fail(409, "Configured admin email is unavailable.");
    }
  }
  return user;
}
