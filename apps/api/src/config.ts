import "dotenv/config";
import { z } from "zod";

// Configuration is loaded at startup; the development watcher includes .env.
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  MONGODB_URI: z.string().optional(),
  PHOTO_STORAGE: z.enum(["auto", "mongodb", "cloudinary"]).default("auto"),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  SMTP_URL: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default("Along <no-reply@along.local>"),
  EMAIL_VERIFICATION_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  JWT_SECRET: z.string().min(32).optional(),
  CORS_ORIGINS: z.string().default("http://localhost:8081"),
  ADMIN_ORIGIN: z.url().default("http://localhost:3000"),
  ADMIN_AUTH_MODE: z.enum(["mfa", "env"]).default("mfa"),
  ADMIN_EMAIL: z
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
  ADMIN_PASSWORD: z.string().min(6).max(72).optional(),
  ADMIN_NAME: z.string().trim().min(2).max(60).default("Along Admin"),
  ADMIN_ENCRYPTION_KEY: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
  ),
});
export const config = schema.parse(process.env);
if (config.ADMIN_AUTH_MODE === "env") {
  if (config.NODE_ENV === "production")
    throw new Error(
      "Environment-only admin login is for local development. Use MFA mode in production.",
    );
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD)
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (6+ characters) in apps/api/.env.",
    );
  if (!config.JWT_SECRET)
    throw new Error("Set JWT_SECRET before enabling environment admin login.");
}
if (
  config.NODE_ENV === "production" &&
  (!config.MONGODB_URI || !config.JWT_SECRET)
) {
  throw new Error(
    "Production requires MONGODB_URI and a JWT_SECRET of at least 32 characters.",
  );
}
