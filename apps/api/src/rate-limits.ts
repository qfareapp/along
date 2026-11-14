import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import type { Request } from "express";
import { requestMember, type AuthedRequest } from "./auth.js";

export const rateLimitMessage = {
  error: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
  },
};

const ipKey = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;

/** For route limiters mounted after authenticate. Never use a client-supplied ID. */
export const memberRateKey = (req: AuthedRequest) =>
  req.userId ? `member:${req.userId}` : ipKey(req);

export function appRateLimits() {
  const options = {
    windowMs: 60_000,
    message: rateLimitMessage,
    standardHeaders: "draft-8" as const,
    legacyHeaders: false,
  };
  return [
    // Bound unauthenticated work before attempting JWT/database validation.
    // This deliberately has more room than the individual account quota,
    // because mobile networks and Wi-Fi put many people behind one IP.
    rateLimit({ ...options, limit: 1200, keyGenerator: ipKey }),
    rateLimit({
      ...options,
      limit: 120,
      keyGenerator: async (req) => {
        const member = await requestMember(req);
        return member ? `member:${member._id}` : ipKey(req);
      },
    }),
  ];
}
