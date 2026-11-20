import { Router, urlencoded } from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { policies, policyVersion, supportEmail } from "../../../packages/policies/index.js";
import { User } from "./models.js";
import { eraseAccount } from "./account-deletion.js";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function page(key: keyof typeof policies, message = "", error = false) {
  const policy = policies[key];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(policy.title)} · Along</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#263f3d;background:#fffaf5;margin:0}main{max-width:760px;margin:auto;padding:28px 20px}a{color:#015d5e}nav{display:flex;flex-wrap:wrap;gap:18px}h1{line-height:1.2}h2{font-size:21px;margin-top:30px}label,input,button{display:block}input{box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px;font:inherit;border:1px solid #999;border-radius:8px}input[type=checkbox]{display:inline;width:auto}button{padding:14px 22px;font:inherit;color:white;background:#015d5e;border:0;border-radius:8px;cursor:pointer}.notice{padding:16px;border:2px solid ${error ? "#b43830" : "#015d5e"};border-radius:8px}</style></head><body><main><nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/child-safety">Child safety</a><a href="/delete-account">Delete account</a></nav><h1>${escape(policy.title)}</h1><p>Along · Updated ${policyVersion}</p>${message ? `<p role="${error ? "alert" : "status"}" class="notice">${escape(message)}</p>` : ""}${policy.sections.map(s => `<section><h2>${escape(s.title)}</h2><p>${escape(s.body)}</p></section>`).join("")}${key === "delete-account" && !message.includes("has been deleted") ? `<h2>Delete permanently</h2><form method="post" action="/delete-account"><label for="email">Along account email</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required><label><input name="confirm" type="checkbox" value="yes" required> I understand that deletion is permanent.</label><p><button type="submit">Delete my Along account</button></p></form>` : ""}<p>Contact: <a href="mailto:${supportEmail}">${supportEmail}</a></p></main></body></html>`;
}
export function publicPoliciesRouter() {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  for (const key of Object.keys(policies) as (keyof typeof policies)[]) {
    router.get(`/${key}`, (_req, res) => res.type("html").send(page(key)));
  }
  const limit = rateLimit({ windowMs: 15 * 60000, limit: 10 });
  router.post("/delete-account", limit, urlencoded({ extended: false, limit: "4kb" }), async (req, res) => {
    // The form does not use any app/admin session cookie; credentials must be entered.
    const origin = req.get("origin");
    if (origin && origin !== `${req.protocol}://${req.get("host")}`) {
      res.status(403).type("html").send(page("delete-account", "Open this form directly on the Along service website to continue.", true)); return;
    }
    if (mongoose.connection.readyState !== 1) {
      res.status(503).type("html").send(page("delete-account", "The service is temporarily unavailable. Try again or contact support.", true)); return;
    }
    const parsed = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(200), confirm: z.literal("yes") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).type("html").send(page("delete-account", "Enter your account email and password, and confirm permanent deletion.", true)); return;
    }
    const user = await User.findOne({ email: parsed.data.email, adminRole: null, status: { $ne: "deleted" } }).select("+passwordHash");
    // Equalise password work when the account does not exist.
    const valid = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy");
    if (!user || !valid) {
      res.status(400).type("html").send(page("delete-account", "We could not verify those account details. Check them or contact support from your registered email.", true)); return;
    }
    await eraseAccount(String(user._id));
    res.type("html").send(page("delete-account", "Your Along account has been deleted. Access is closed and your media has been queued for removal."));
  });
  return router;
}
