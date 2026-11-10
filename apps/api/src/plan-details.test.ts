import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fieldsForCategory,
  validatePlanDetails,
  type PlanDetails,
} from "../../../packages/plan-details/index.js";
import { defaultCategories } from "./categories.js";
import { activityInput, checkPlanDetails } from "./validation.js";

export function exampleDetails(category: string): PlanDetails {
  return Object.fromEntries(
    fieldsForCategory(category).map((field) => [
      field.key,
      field.kind === "days"
        ? ["Mon", "Wed", "Fri"]
        : field.kind === "choice"
          ? field.options![0]
          : field.kind === "time"
            ? "08:30"
            : field.kind === "date"
              ? "2030-06-10"
              : field.kind === "number"
                ? "60"
                : `Example ${field.key}`,
    ]),
  );
}
for (const [category] of defaultCategories) {
  test(`${category}: category details require essentials and accept a complete plan`, () => {
    assert.ok(Object.keys(validatePlanDetails(category, {})).length);
    const details = exampleDetails(category);
    assert.deepEqual(validatePlanDetails(category, details), {});
    assert.doesNotThrow(() => checkPlanDetails(category, details));
    assert.throws(() =>
      checkPlanDetails(category, { ...details, unexpected: "hidden" }),
    );
  });
}
test("commute rejects invalid times, weekdays and category-mismatched details", () => {
  const valid = exampleDetails("commute");
  for (const overrides of [
    { departureTime: "25:00" },
    { workingDays: [] },
    { workingDays: ["Monday"] },
    { workingDays: ["Mon", "Mon"] },
    { source: "  " },
    { returnTime: ["08:00"] },
  ]) {
    assert.throws(() =>
      checkPlanDetails("commute", { ...valid, ...overrides }),
    );
  }
  assert.throws(() => checkPlanDetails("food", valid));
  assert.doesNotThrow(() => checkPlanDetails("commute", undefined));
});
test("category detail dates and durations reject invalid values", () => {
  for (const value of ["2030-02-30", "2030-13-01", "tomorrow"])
    assert.throws(() =>
      checkPlanDetails("travel", {
        ...exampleDetails("travel"),
        returnDate: value,
      }),
    );
  for (const value of ["0", "1.5", "1500"])
    assert.throws(() =>
      checkPlanDetails("fitness", {
        ...exampleDetails("fitness"),
        duration: value,
      }),
    );
  assert.throws(() =>
    activityInput.parse({ categoryDetails: { value: "x".repeat(301) } }),
  );
});
