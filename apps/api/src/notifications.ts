import { Router } from "express";
import mongoose from "mongoose";
import { authenticate, type AuthedRequest } from "./auth.js";
import { Activity, ActivityInterest, User } from "./models.js";
import { fail, requireReady } from "./onboarding.js";
import { acceptActivityInterest, activityScope } from "./activities.js";

// Interest records are the durable notifications, including likes made before this feature.
async function visibleInterests(userId: string) {
  const scope = await activityScope(userId);
  const activities = await Activity.find(scope.filter)
    .select("title creator")
    .lean();
  const users = await User.find({ _id: { $in: scope.filter.creator.$in } })
    .select("name")
    .lean();
  const own = activities.filter((a) => String(a.creator) === userId);
  return {
    activities,
    users,
    filter: {
      activity: { $in: own.map((a) => a._id) },
      user: { $in: users.map((u) => u._id) },
    },
  };
}

export function notificationsRouter() {
  const router = Router();
  router.use(authenticate, requireReady);
  router.get("/", async (req: AuthedRequest, res) => {
    const { activities, users, filter } = await visibleInterests(req.userId!);
    const interests = await ActivityInterest.find({
      $or: [
        filter,
        {
          user: req.userId,
          activity: { $in: activities.map((a) => a._id) },
          status: { $in: ["accepted", "declined"] },
        },
      ],
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean();
    const titles = new Map(activities.map((a) => [String(a._id), a.title]));
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    res.json({
      data: interests.map((i) => ({
        id: String(i._id),
        activityId: String(i.activity),
        activityTitle: titles.get(String(i.activity)),
        member:
          String(i.user) === req.userId
            ? {
                id: String(
                  activities.find((a) => String(a._id) === String(i.activity))
                    ?.creator,
                ),
                name: names.get(
                  String(
                    activities.find((a) => String(a._id) === String(i.activity))
                      ?.creator,
                  ),
                ),
              }
            : { id: String(i.user), name: names.get(String(i.user)) },
        role: String(i.user) === req.userId ? "applicant" : "owner",
        status: i.status ?? "pending",
        conversationId: i.conversation ? String(i.conversation) : null,
        createdAt: i.createdAt,
        readAt:
          (String(i.user) === req.userId ? i.responseReadAt : i.readAt) ?? null,
      })),
    });
  });
  router.post("/:id/read", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Notification unavailable.");
    const { filter, activities } = await visibleInterests(req.userId!);
    const interest = await ActivityInterest.findOne({
      _id: req.params.id,
      $or: [
        filter,
        {
          user: req.userId,
          activity: { $in: activities.map((a) => a._id) },
          status: { $in: ["accepted", "declined"] },
        },
      ],
    });
    if (!interest) throw fail(404, "Notification unavailable.");
    await ActivityInterest.updateOne(
      { _id: interest._id },
      {
        $set: {
          [String(interest.user) === req.userId ? "responseReadAt" : "readAt"]:
            new Date(),
        },
      },
    );
    res.status(204).end();
  });
  router.post("/:id/conversation", async (req: AuthedRequest, res) => {
    if (!mongoose.isObjectIdOrHexString(req.params.id))
      throw fail(404, "Notification unavailable.");
    const { filter } = await visibleInterests(req.userId!);
    const interest = await ActivityInterest.findOne({
      ...filter,
      _id: req.params.id,
    });
    if (!interest) throw fail(404, "Notification unavailable.");
    const id = await acceptActivityInterest(req.userId!, req.params.id);
    res.json({ data: { id } });
  });
  return router;
}
