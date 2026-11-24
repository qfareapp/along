import crypto from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "./config.js";
import { tokens } from "./auth.js";
import { emailTransport } from "./email.js";
import { signInCodeEmail } from "./email-templates.js";
import { User, Profile, RefreshSession } from "./models.js";
import { isAdult } from "./validation.js";
import { policyVersion } from "../../../packages/policies/index.js";
import { EmailLoginChallenge } from "./email-login-models.js";
import { rateLimitMessage } from "./rate-limits.js";

const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
const invalid = () =>
  fail(
    400,
    "This sign-in code is incorrect, expired or already used. Request a new code.",
  );
const hash = (purpose: string, value: string) =>
  crypto
    .createHmac("sha256", config.JWT_SECRET!)
    .update(`along-email-login:${purpose}:${value}`)
    .digest("hex");

export function emailLoginRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.post(
    "/request",
    rateLimit({ windowMs: 60000, limit: 3, message: rateLimitMessage }),
    async (req, res) => {
      const { email } = z
        .object({
          email: z
            .string()
            .trim()
            .pipe(z.email().max(254))
            .transform((value) => value.toLowerCase()),
        })
        .strict()
        .parse(req.body);
      const transport = emailTransport();
      if (!transport || !config.JWT_SECRET)
        throw fail(
          503,
          "Email sign-in is temporarily unavailable. Please use your password or try again later.",
        );
      const now = new Date(),
        hourAgo = new Date(+now - 3600000);
      const requestId = crypto.randomBytes(24).toString("base64url");
      const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
      const user = await User.findOne({ email }).select(
        "_id email status adminRole",
      );
      const canDeliver = !user || (user.status === "active" && !user.adminRole);
      const newWindow = {
        $lte: [{ $ifNull: ["$windowStartedAt", new Date(0)] }, hourAgo],
      };
      try {
        // Reserve cooldown/quota for new addresses too. Email is retained only in this TTL record.
        // The unique email key makes simultaneous requests contend atomically across instances.
        await EmailLoginChallenge.findOneAndUpdate(
          {
            emailKey: hash("address", email),
            $and: [
              {
                $or: [
                  { requestedAt: { $lte: new Date(+now - 60000) } },
                  { requestedAt: { $exists: false } },
                ],
              },
              {
                $or: [
                  { sendCount: { $lt: 5 } },
                  { windowStartedAt: { $lte: hourAgo } },
                  { windowStartedAt: { $exists: false } },
                ],
              },
            ],
          },
          [
            {
              $set: {
                emailKey: hash("address", email),
                email: { $literal: email },
                requestId,
                user: user?._id ?? null,
                codeHash: hash("code", `${requestId}:${code}`),
                attempts: 0,
                consumed: false,
                signupTokenHash: null,
                signupExpiresAt: null,
                requestedAt: now,
                expiresAt: new Date(+now + 5 * 60000),
                cleanupAt: new Date(+now + 3600000),
                windowStartedAt: {
                  $cond: [newWindow, now, "$windowStartedAt"],
                },
                sendCount: {
                  $cond: [
                    newWindow,
                    1,
                    { $add: [{ $ifNull: ["$sendCount", 0] }, 1] },
                  ],
                },
              },
            },
          ],
          { upsert: true, new: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw fail(
            429,
            "Please wait at least 60 seconds before requesting another code. You can request up to five codes per hour.",
          );
        throw error;
      }
      // Flush the same response before SMTP work, so delivery latency does not expose membership.
      res.json({
        data: {
          requestId,
          expiresIn: 300,
          resendAfter: 60,
          message:
            "If this email can use Along, a code will arrive shortly. Use it to sign in or create your account.",
        },
      });
      if (canDeliver) {
        try {
          await transport.sendMail({
            from: config.EMAIL_FROM,
            to: email,
            ...signInCodeEmail(code),
          });
        } catch {
          try {
            await EmailLoginChallenge.updateOne(
              { requestId },
              { $set: { consumed: true }, $unset: { codeHash: 1 } },
            );
          } catch {
            /* Never log a recipient, code or SMTP credential. */
          }
          console.error(
            JSON.stringify({ event: "email_login_delivery_failed" }),
          );
        }
      }
    },
  );
  router.post(
    "/verify",
    rateLimit({ windowMs: 15 * 60000, limit: 20, message: rateLimitMessage }),
    async (req, res) => {
      const input = z
        .object({
          requestId: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
          code: z
            .string()
            .trim()
            .regex(/^\d{6}$/),
        })
        .strict()
        .parse(req.body);
      if (!config.JWT_SECRET)
        throw fail(503, "Email sign-in is temporarily unavailable.");
      const challenge = await EmailLoginChallenge.findOneAndUpdate(
        {
          requestId: input.requestId,
          consumed: false,
          expiresAt: { $gt: new Date() },
          attempts: { $lt: 5 },
        },
        { $inc: { attempts: 1 } },
        { new: true },
      ).select("+codeHash +email");
      const expected = hash("code", `${input.requestId}:${input.code}`);
      if (
        !challenge?.email ||
        !challenge.codeHash ||
        challenge.codeHash.length !== expected.length ||
        !crypto.timingSafeEqual(
          Buffer.from(challenge.codeHash),
          Buffer.from(expected),
        )
      )
        throw invalid();
      const signupToken = crypto.randomBytes(32).toString("base64url");
      // An unverified legacy account must not retain a password/session chosen by
      // someone who registered the email before its real owner proved ownership.
      const candidate = await User.findOne({ email: challenge.email });
      const replacementPassword =
        candidate && !candidate.emailVerified
          ? await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12)
          : undefined;
      const data = await mongoose.connection.transaction(async (session) => {
        const consumed = await EmailLoginChallenge.updateOne(
          {
            _id: challenge._id,
            requestId: input.requestId,
            consumed: false,
            codeHash: expected,
            expiresAt: { $gt: new Date() },
          },
          { $set: { consumed: true }, $unset: { codeHash: 1 } },
          { session },
        );
        if (!consumed.modifiedCount) throw invalid();
        const user = await User.findOne({ email: challenge.email }).session(
          session,
        );
        if (!user) {
          await EmailLoginChallenge.updateOne(
            { _id: challenge._id },
            {
              $set: {
                signupTokenHash: hash("signup", signupToken),
                signupExpiresAt: new Date(Date.now() + 15 * 60000),
              },
            },
            { session },
          );
          return { isNewUser: true as const, signupToken, expiresIn: 900 };
        }
        if (user.status !== "active" || user.adminRole) throw invalid();
        if (!user.emailVerified) {
          if (!replacementPassword) throw invalid();
          await User.updateOne(
            { _id: user._id },
            {
              $set: { emailVerified: true, passwordHash: replacementPassword },
              $inc: { sessionVersion: 1 },
              $unset: {
                contactCodeHash: 1,
                contactCodeExpiresAt: 1,
                passwordResetHash: 1,
                passwordResetExpiresAt: 1,
                passwordResetAttempts: 1,
                passwordResetRequestedAt: 1,
              },
            },
            { session },
          );
          await RefreshSession.deleteMany({ user: user._id }, { session });
        }
        await EmailLoginChallenge.updateOne(
          { _id: challenge._id },
          { $set: { user: user._id } },
          { session },
        );
        return {
          isNewUser: false as const,
          ...(await tokens(String(user._id), session)),
          user: { id: String(user._id), name: user.name, emailVerified: true },
        };
      });
      res.json({ data });
    },
  );
  router.post(
    "/register",
    rateLimit({ windowMs: 15 * 60000, limit: 20, message: rateLimitMessage }),
    async (req, res) => {
      const input = z
        .object({
          signupToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          name: z.string().trim().min(2).max(60),
          birthDate: z.iso
            .date()
            .refine(
              (value) => isAdult(value),
              "Along is for adults aged 18 and over.",
            ),
          acceptTerms: z.literal(true),
          acceptGuidelines: z.literal(true),
        })
        .strict()
        .parse(req.body);
      if (!config.JWT_SECRET)
        throw fail(503, "Account creation is temporarily unavailable.");
      const tokenHash = hash("signup", input.signupToken);
      const passwordHash = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        12,
      );
      try {
        const data = await mongoose.connection.transaction(async (session) => {
          const grant = await EmailLoginChallenge.findOneAndUpdate(
            {
              signupTokenHash: tokenHash,
              consumed: true,
              signupExpiresAt: { $gt: new Date() },
            },
            { $unset: { signupTokenHash: 1, signupExpiresAt: 1 } },
            { session, new: true },
          ).select("+email");
          if (!grant?.email)
            throw fail(
              400,
              "Your account setup session expired or was already used. Request a new email code.",
            );
          const [user] = await User.create(
            [
              {
                email: grant.email,
                emailVerified: true,
                passwordHash,
                name: input.name,
                birthDate: new Date(`${input.birthDate}T00:00:00Z`),
              },
            ],
            { session },
          );
          await Profile.create(
            [
              {
                user: user!._id,
                consents: {
                  termsAt: new Date(),
                  guidelinesAt: new Date(),
                  version: policyVersion,
                },
              },
            ],
            { session },
          );
          await EmailLoginChallenge.updateOne(
            { _id: grant._id },
            { $set: { user: user!._id } },
            { session },
          );
          return {
            ...(await tokens(String(user!._id), session)),
            isNewUser: true,
            user: {
              id: String(user!._id),
              name: user!.name,
              emailVerified: true,
            },
          };
        });
        res.status(201).json({ data });
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          throw fail(
            409,
            "An account already uses this email. Request a new code to sign in.",
          );
        throw error;
      }
    },
  );
  return router;
}
