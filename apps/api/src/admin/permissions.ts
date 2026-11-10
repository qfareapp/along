import { AdminRole } from "./models.js";
export const permissions = [
  "dashboard.read",
  "users.read",
  "users.suspend",
  "users.ban",
  "users.export",
  "verification.review",
  "activities.moderate",
  "categories.manage",
  "matching.configure",
  "reports.review",
  "messages.review_reported",
  "subscriptions.manage",
  "analytics.read",
  "settings.manage",
  "admins.manage",
  "audit.read",
  "support.manage",
  "cms.manage",
  "system.read",
] as const;
export type Permission = (typeof permissions)[number];
export const roles: {
  slug: string;
  name: string;
  permissions: readonly Permission[];
}[] = [
  { slug: "super-admin", name: "Super Admin", permissions },
  {
    slug: "operations",
    name: "Operations Admin",
    permissions: [
      "dashboard.read",
      "users.read",
      "users.suspend",
      "verification.review",
      "activities.moderate",
      "categories.manage",
      "reports.review",
      "analytics.read",
      "support.manage",
      "cms.manage",
      "system.read",
    ],
  },
  {
    slug: "trust-safety",
    name: "Trust & Safety Officer",
    permissions: [
      "dashboard.read",
      "users.read",
      "users.suspend",
      "users.ban",
      "reports.review",
      "messages.review_reported",
      "activities.moderate",
      "audit.read",
    ],
  },
  {
    slug: "verification",
    name: "Verification Officer",
    permissions: ["dashboard.read", "users.read", "verification.review"],
  },
  {
    slug: "support",
    name: "Support Agent",
    permissions: ["dashboard.read", "users.read", "support.manage"],
  },
  {
    slug: "finance",
    name: "Finance Admin",
    permissions: ["dashboard.read", "subscriptions.manage", "analytics.read"],
  },
  {
    slug: "marketing",
    name: "Marketing Admin",
    permissions: ["dashboard.read", "analytics.read", "cms.manage"],
  },
  {
    slug: "analyst",
    name: "Data Analyst",
    permissions: ["dashboard.read", "analytics.read"],
  },
];
export async function seedRoles() {
  for (const role of roles)
    await AdminRole.updateOne(
      { slug: role.slug },
      { $setOnInsert: role },
      { upsert: true },
    );
}
