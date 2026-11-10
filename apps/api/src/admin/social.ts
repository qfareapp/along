import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Report, Message } from "../models.js";
import {
  SocialMoment,
  MomentReaction,
  MomentView,
  PlanInvitation,
} from "../social-models.js";
import { audit, permit, fail, type AdminRequest } from "./security.js";
import { AuditLog } from "./models.js";
import { readMomentPhoto } from "../social-storage.js";
const reason = z.string().trim().min(10).max(1500);
const reportId = (value: unknown) => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(404, "Report not found.");
  return value;
};
export function socialAdminRouter() {
  const router = Router();
  router.get("/analytics", permit("analytics.read"), async (_req, res) => {
    const since = new Date(Date.now() - 7 * 86400000);
    const [
      distribution,
      views,
      reactions,
      replies,
      plans,
      reports,
      removed,
      viewers,
    ] = await Promise.all([
      SocialMoment.aggregate([
        { $match: { publishedAt: { $gte: since } } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      MomentView.countDocuments({ createdAt: { $gte: since } }),
      MomentReaction.countDocuments({ createdAt: { $gte: since } }),
      Message.countDocuments({
        socialMoment: { $exists: true },
        socialKind: "reply",
        createdAt: { $gte: since },
      }),
      PlanInvitation.countDocuments({
        status: "accepted",
        updatedAt: { $gte: since },
      }),
      Report.countDocuments({
        moment: { $exists: true },
        createdAt: { $gte: since },
      }),
      SocialMoment.countDocuments({
        status: "removed",
        updatedAt: { $gte: since },
      }),
      MomentView.distinct("user", {
        createdAt: { $gte: new Date(Date.now() - 86400000) },
      }),
    ]);
    res.json({
      data: {
        days: 7,
        distribution,
        views,
        reactions,
        replies,
        plans,
        reports,
        removed,
        dailyViewers: viewers.length,
      },
    });
  });
  router.get("/reports", permit("reports.review"), async (req, res) => {
    const { page } = z
      .object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
      .parse(req.query);
    const filter = { moment: { $exists: true } };
    const [reports, total] = await Promise.all([
      Report.find(filter)
        .select("reason status severity target createdAt moment")
        .populate("target", "name status")
        .sort({ _id: -1 })
        .skip((page - 1) * 20)
        .limit(20)
        .lean(),
      Report.countDocuments(filter),
    ]);
    res.json({
      data: {
        items: reports.map((r) => ({
          id: String(r._id),
          reason: r.reason,
          status: r.status,
          severity: r.severity,
          target: r.target,
          createdAt: r.createdAt,
        })),
        total,
        page,
      },
    });
  });
  router.get(
    "/reports/:id",
    permit("reports.review"),
    async (req: AdminRequest, res) => {
      const report = await Report.findOne({
        _id: reportId(req.params.id),
        moment: { $exists: true },
      }).lean();
      if (!report) throw fail(404, "Report not found.");
      const reviewReason = reason.parse(req.query.reason);
      await audit(
        req,
        "social.report_content_viewed",
        "Report",
        String(report._id),
        reviewReason,
      );
      const moment = await SocialMoment.findById(report.moment).lean();
      res.json({
        data: {
          reportId: String(report._id),
          reason: report.reason,
          status: report.status,
          notes: report.notes,
          moment: moment
            ? {
                id: String(moment._id),
                type: moment.type,
                text: moment.text,
                caption: moment.caption,
                status: moment.status,
                publishedAt: moment.publishedAt,
                expiresAt: moment.expiresAt,
                hasPhoto: moment.type === "photo",
              }
            : null,
        },
      });
    },
  );
  router.get(
    "/reports/:id/media",
    permit("reports.review"),
    async (req: AdminRequest, res) => {
      const reviewReason = reason.parse(req.query.reason);
      const report = await Report.findOne({
        _id: reportId(req.params.id),
        moment: { $exists: true },
      });
      const moment = report
        ? await SocialMoment.findById(report.moment).select("+media")
        : null;
      if (!moment?.media) throw fail(404, "Reported media unavailable.");
      await audit(
        req,
        "social.report_media_viewed",
        "Report",
        String(report!._id),
        reviewReason,
      );
      res.type("image/jpeg").send(await readMomentPhoto(moment.media));
    },
  );
  router.post(
    "/reports/:id/moderate",
    permit("reports.review"),
    async (req: AdminRequest, res) => {
      const b = z
        .object({ action: z.enum(["remove", "dismiss", "escalate"]), reason })
        .strict()
        .parse(req.body);
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const report = await Report.findOne({
            _id: reportId(req.params.id),
            moment: { $exists: true },
          }).session(session);
          if (!report) throw fail(404, "Report not found.");
          if (b.action === "remove")
            await SocialMoment.updateOne(
              { _id: report.moment },
              { $set: { status: "removed" } },
              { session },
            );
          await Report.updateOne(
            { _id: report._id },
            {
              $set: {
                status:
                  b.action === "remove"
                    ? "action_taken"
                    : b.action === "dismiss"
                      ? "dismissed"
                      : "escalated",
                assignedTo: req.admin!.id,
              },
              $push: {
                notes: { text: b.reason, by: req.admin!.id, at: new Date() },
              },
            },
            { session },
          );
          await AuditLog.create(
            [
              {
                admin: req.admin!.id,
                action: `social.${b.action}`,
                targetType: "Report",
                targetId: String(report._id),
                reason: b.reason,
                outcome: "success",
                requestId: req.requestId,
              },
            ],
            { session },
          );
        });
      } finally {
        await session.endSession();
      }
      res.status(204).end();
    },
  );
  return router;
}
