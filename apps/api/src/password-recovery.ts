import crypto from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "./config.js";
import { digest } from "./auth.js";
import { emailTransport } from "./email.js";
import { User, RefreshSession } from "./models.js";
import { rateLimitMessage } from "./rate-limits.js";
import { EmailLoginChallenge } from "./email-login-models.js";

const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
const invalid = () =>
  fail(400, "The recovery code is incorrect or expired. Request a new code.");
const codeHash = (user: unknown, code: string) =>
  digest(`${user}:${code}:${config.JWT_SECRET}`);

export function passwordRecoveryRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/request",
    rateLimit({ windowMs: 60000, limit: 3, message: rateLimitMessage }),
    async (req, res) => {
      const input = z.object({ email }).strict().parse(req.body);
      const transport = emailTransport();
      if (!transport || !config.JWT_SECRET)
        throw fail(
          503,
          "Account recovery is temporarily unavailable. Please contact support.",
        );
      const code = crypto.randomBytes(6).toString("hex");
      const user = await User.findOne({
        email: input.email,
        status: "active",
        adminRole: null,
      });
      if (user) {
        const hash = codeHash(user._id, code);
        const reserved = await User.updateOne(
          {
            _id: user._id,
            status: "active",
            $or: [
              {
                passwordResetRequestedAt: { $lt: new Date(Date.now() - 60000) },
              },
              { passwordResetRequestedAt: { $exists: false } },
            ],
          },
          {
            $set: {
              passwordResetHash: hash,
              passwordResetExpiresAt: new Date(Date.now() + 15 * 60000),
              passwordResetRequestedAt: new Date(),
              passwordResetAttempts: 0,
            },
          },
        );
        if (reserved.modifiedCount) {
          try {
            await transport.sendMail({
              from: config.EMAIL_FROM,
              to: user.email,
              subject: "Reset your Along password",
              text: `Your Along recovery code is ${code}. It expires in 15 minutes. Enter it in Along's Reset password screen. If you did not request this, ignore this message. Never share this code.`,
            });
          } catch {
            await User.updateOne(
              { _id: user._id, passwordResetHash: hash },
              { $unset: { passwordResetHash: 1, passwordResetExpiresAt: 1 } },
            );
            console.error(
              JSON.stringify({ event: "password_recovery_delivery_failed" }),
            );
          }
        }
      }
      // Identical response for unknown, inactive, rate-held and eligible addresses.
      res.json({
        data: {
          sent: true,
          message:
            "If an eligible account uses that email, a recovery code will arrive shortly.",
        },
      });
    },
  );
  router.post(
    "/reset",
    rateLimit({ windowMs: 15 * 60000, limit: 20, message: rateLimitMessage }),
    async (req, res) => {
      const input = z
        .object({
          email,
          code: z
            .string()
            .trim()
            .toLowerCase()
            .regex(/^[a-f0-9]{12}$/),
          password: z.string().min(10).max(72),
        })
        .strict()
        .parse(req.body);
      const user = await User.findOneAndUpdate(
        {
          email: input.email,
          status: "active",
          adminRole: null,
          passwordResetExpiresAt: { $gt: new Date() },
          passwordResetAttempts: { $lt: 5 },
        },
        { $inc: { passwordResetAttempts: 1 } },
        { new: true },
      ).select("+passwordResetHash");
      const expected = user
        ? codeHash(user._id, input.code)
        : digest(input.code);
      if (
        !user?.passwordResetHash ||
        user.passwordResetHash.length !== expected.length ||
        !crypto.timingSafeEqual(
          Buffer.from(user.passwordResetHash),
          Buffer.from(expected),
        )
      )
        throw invalid();
      const passwordHash = await bcrypt.hash(input.password, 12);
      await mongoose.connection.transaction(async (session) => {
        const changed = await User.updateOne(
          {
            _id: user._id,
            status: "active",
            passwordResetHash: expected,
            passwordResetExpiresAt: { $gt: new Date() },
          },
          {
            $set: { passwordHash },
            $inc: { sessionVersion: 1 },
            $unset: {
              passwordResetHash: 1,
              passwordResetExpiresAt: 1,
              passwordResetAttempts: 1,
              passwordResetRequestedAt: 1,
            },
          },
          { session },
        );
        if (!changed.modifiedCount) throw invalid();
        await RefreshSession.deleteMany({ user: user._id }, { session });
        await EmailLoginChallenge.updateMany(
          { user: user._id },
          { $set: { consumed: true }, $unset: { codeHash: 1 } },
          { session },
        );
      });
      res.json({ data: { reset: true } });
    },
  );
  return router;
}
