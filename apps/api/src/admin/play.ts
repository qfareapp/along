import crypto from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  GameDefinition,
  GameQuestion,
  playCategories,
} from "../play-models.js";
import { initializePlay } from "../play-bank.js";
import { playId } from "../play.js";
import { AuditLog } from "./models.js";
import { permit, fail, type AdminRequest } from "./security.js";

const questionInput = z
  .object({
    category: z.enum(playCategories),
    text: z.string().trim().min(5).max(200),
    optionA: z.string().trim().min(1).max(80),
    optionB: z.string().trim().min(1).max(80),
    active: z.boolean(),
    tone: z.string().trim().min(1).max(40).default("playful"),
    reason: z.string().trim().min(10).max(1500),
  })
  .strict()
  .refine(
    (v) => v.optionA.toLowerCase() !== v.optionB.toLowerCase(),
    "Provide two different options.",
  );
export function playAdminRouter() {
  const router = Router();
  router.use(permit("settings.manage"));
  router.get("/questions", async (req, res) => {
    if (!(await GameDefinition.exists({ key: "this_or_that" })))
      await initializePlay();
    const category = z
      .enum(playCategories)
      .optional()
      .parse(req.query.category);
    const questions = await GameQuestion.find(category ? { category } : {})
      .sort({ category: 1, createdAt: -1 })
      .lean();
    const definition = await GameDefinition.findOne({
      key: "this_or_that",
    }).lean();
    res.json({
      data: {
        questions,
        definition: definition
          ? {
              active: definition.active,
              questionsPerCategory: definition.questionsPerCategory,
              invitationMinutes: definition.invitationMinutes,
              inactivityMinutes: definition.inactivityMinutes,
            }
          : null,
        categories: playCategories,
        activeCount: await GameQuestion.countDocuments({ active: true }),
      },
    });
  });
  for (const method of ["post", "patch"] as const)
    router[method](
      method === "post" ? "/questions" : "/questions/:id",
      async (req: AdminRequest, res) => {
        const { reason, ...input } = questionInput.parse(req.body);
        let questionId = "";
        await mongoose.connection.transaction(async (session) => {
          if (method === "post") {
            const [question] = await GameQuestion.create(
              [{ ...input, key: `custom-${crypto.randomUUID()}` }],
              { session },
            );
            questionId = String(question!._id);
          } else {
            const question = await GameQuestion.findByIdAndUpdate(
              playId(req.params.id),
              { $set: input },
              { new: true, runValidators: true, session },
            );
            if (!question) throw fail(404, "Question unavailable.");
            questionId = String(question._id);
          }
          await AuditLog.create(
            [
              {
                admin: req.admin!.id,
                action:
                  method === "post"
                    ? "game.question_created"
                    : "game.question_updated",
                targetType: "GameQuestion",
                targetId: questionId,
                reason,
                requestId: req.requestId,
              },
            ],
            { session },
          );
        });
        res
          .status(method === "post" ? 201 : 200)
          .json({ data: { id: questionId } });
      },
    );
  router.patch("/settings", async (req: AdminRequest, res) => {
    const { reason, ...input } = z
      .object({
        active: z.boolean(),
        questionsPerCategory: z.number().int().min(1).max(5),
        invitationMinutes: z.number().int().min(5).max(120),
        inactivityMinutes: z.number().int().min(5).max(120),
        reason: z.string().trim().min(10).max(1500),
      })
      .strict()
      .parse(req.body);
    if (input.active)
      for (const category of playCategories)
        if (
          (await GameQuestion.countDocuments({ category, active: true })) <
          input.questionsPerCategory
        )
          throw fail(409, `Add more active ${category} questions first.`);
    await mongoose.connection.transaction(async (session) => {
      await GameDefinition.updateOne(
        { key: "this_or_that" },
        { $set: input },
        { session, upsert: true, runValidators: true },
      );
      await AuditLog.create(
        [
          {
            admin: req.admin!.id,
            action: "game.settings_updated",
            targetType: "GameDefinition",
            targetId: "this_or_that",
            reason,
            requestId: req.requestId,
          },
        ],
        { session },
      );
    });
    res.json({ data: input });
  });
  return router;
}
