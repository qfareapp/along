# Explore Plans implementation

The live app now uses category browsing → people and plans → activity details → interest request → organizer acceptance → conversation. Production screens read the existing Express API and shared MongoDB models. Viewing or saving a plan never creates a match. The organizer sends the first message after accepting a request.

## Files created

- `apps/api/src/activities.ts`: shared visibility scope, counts, paginated browsing, public organizer serialization, bookmarks and transactional acceptance.
- `apps/api/src/activities.test.ts`: MongoDB regression coverage.
- `apps/api/src/plans-browser-qa.ts` and `tools/plans-qa.mjs`: isolated database and browser flow; run `npm run qa:plans` from the repository root.
- `apps/mobile/src/services/plans.ts`: debounced search, paginated queries, bookmarks, refreshes and migration of accessible live bookmarks previously saved on the device.
- `apps/mobile/src/features/PlanComponents.tsx`: category cards, organizer-led activity cards, search and skeletons.
- `apps/mobile/src/features/LiveActivityDetail.tsx`: live details, sticky interest action, saving, sharing, reporting, blocking and owner deletion.
- `apps/mobile/src/app/plans/category/[categoryId].tsx`, `plans/all.tsx`, `plans/saved.tsx`: category, all-plan and saved-plan routes.
- `apps/mobile/assets/categories/`: 13 original vector illustrations and bundled PNG equivalents, rebuilt with `node tools/category-covers.mjs`. These assets were authored for Along and contain no third-party stock images, fonts or runtime generation dependencies.
- `docs/plans-screenshots/`: six browser screenshots of the implemented flow using isolated test fixtures.

## Files modified

- `apps/mobile/src/features/Plans.tsx`: category grid, city header, search, live counts, For You, filters, sorting, pagination, refresh and empty/error states.
- `apps/mobile/src/features/ActivityDetail.tsx`: selects the live detail implementation while retaining the existing explicit demo detail flow.
- `apps/mobile/src/features/CreatePlan.tsx` and `src/app/(tabs)/create.tsx`: category preselection, one-on-one/group selection and capacity.
- `apps/mobile/src/features/ActivityNotifications.tsx`: organizer acceptance/decline actions and applicant responses.
- `apps/mobile/src/features/LiveDiscover.tsx`: authenticated organizer photo caching and retry behavior.
- `apps/mobile/src/features/LiveChat.tsx` and `services/chat.ts`: distinguish a shared-plan connection from a romantic profile match.
- `apps/mobile/src/features/Settings.tsx`: attach the activity reference to reports.
- `apps/api/src/app.ts`: mount the activity router, retain legacy list compatibility, validate posting/update fields, and associate reports with activities.
- `apps/api/src/discovery.ts`: export the existing compatibility helper for reuse.
- `apps/api/src/models.ts`, `validation.ts`, `chat.ts`, `notifications.ts`: additive data fields and integration with existing requests and chat.
- `apps/api/src/admin/router.ts`, `apps/admin/src/components/categories.tsx`, `packages/shared-types/admin.d.ts`: category cover selection/custom HTTPS URLs and global live counts, preserving existing permissions, audit reasons, city controls, ordering and moderation.
- `apps/api/src/notifications.test.ts`, `src/admin/admin.test.ts`: acceptance and admin-to-mobile regression checks.
- `package.json`: `qa:plans` command.

## API changes

All paths below are under `/api/v1` and enforce authentication and profile eligibility.

| Endpoint | Behavior |
| --- | --- |
| `GET /activities/categories?q=` | Enabled categories in the viewer's city, with eligible live counts and cover metadata. |
| `GET /activities/browse` | `{ items, total, nextOffset }` inside `data`; supports `category`, `q`, `sort=recommended\|soon\|nearest\|newest`, `when=any\|today\|weekend`, `kind=any\|one_on_one\|group`, `nearby`, `saved`, `offset`, `limit` and client `timezoneOffset`. |
| `GET /activities/:id` | Full visible activity, safe organizer fields, owned public photo ID, saved/request states and availability. Exact coordinates, birth dates and contact information are excluded. |
| `POST /activities/:id/interests` | Idempotent pending request; validates visibility, expiry, capacity and ownership. |
| `POST /activities/:id/save` / `DELETE /activities/:id/save` | Persist or remove the current user's bookmark. |
| `POST /activities/:id/interests/:interestId/decline` | Organizer declines a pending request. |
| `POST /notifications/:id/conversation` | Organizer accepts, reserves capacity and creates/reuses chat atomically. Owner-first messaging remains enforced. |
| `GET /notifications`, `POST /notifications/:id/read` | Requests for organizers and accepted/declined responses for applicants, with independent read states. |

The existing activity creation/update/delete routes and legacy `GET /activities` remain available. Admin category create/update accepts `coverAssetKey` and optional `coverImageUrl`; admin category listing includes global live counts. Admin may select a bundled illustration or replace it with a managed HTTPS image URL.

Counts and browse results share the same scope: active categories, city/radius, existing discovery visibility rules, discovery eligibility, blocks, account status and live timing. Members open to the viewer remain visible as in Discover; mutual preferences rank first. Upcoming plans, ongoing plans with a future end, and recurring plans without an expired end are included. Full plans remain visible with an explicit full status. Recommendation ordering reuses existing shared vibes and vibe-to-category mappings.

## Database changes and rollout

Existing database configuration is unchanged; no replacement database or duplicate category catalog is introduced. Tests and browser QA use disposable MongoDB instances, never the configured Atlas database.

- Category: optional `coverAssetKey`, `coverImageUrl`.
- ActivityPost: optional `highlight`, `endsAt`, `activityType`, `capacity`, and accepted `participants`.
- ActivityInterest: `pending`/`accepted`/`declined` status, conversation reference and applicant response read time, in addition to the existing organizer read time.
- ActivitySave: new bookmark collection because previous live bookmarks were stored only on the device; unique `(user, activity)` index.
- Report: optional activity reference.
- Added activity indexes for active category/time listings and creator/status queries, plus a request user/status index. Existing category slugs, activity IDs, interest uniqueness and conversation pair uniqueness are preserved.

Legacy activities without the new fields behave as one-on-one plans with one available place. Existing interest records without status behave as pending requests. No destructive data migration is required. Allow the existing Mongoose index initialization policy to create the additive indexes, or create those same indexes through your deployment's index-management process if automatic indexing is disabled.

Acceptance uses MongoDB transactions so a full activity or closed conversation cannot leave a partial reservation. Atlas and the existing local replica-set development command support this; standalone MongoDB servers must run as a replica set for acceptance.

## Verification

- Full existing and new API suite passed: 90 tests before the final legacy-document regression was added; the affected activity, admin, chat and notification suites were rerun after final changes.
- API, mobile and admin TypeScript checks passed. Admin check uses `tsc --noEmit --incremental false` because the existing build-cache file is not writable in this workspace.
- Mobile ESLint passed with `eslint src --no-cache`; the Expo wrapper's existing lint cache has a filesystem permission issue.
- Expo web export and browser QA passed with actual isolated MongoDB records: category grid/search/navigation, decoded organizer photo, combined filters, saved-plan navigation and persistence, full details, no automatic chat, request persistence, organizer acceptance, owner-first message, applicant reply and empty-category posting preselection. Browser page-error collection was empty.
- All cover images are bundled; no new app dependencies or native modules were added.

## Device checks and limits

Physical Expo Go testing was not available in this environment. Native share-sheet presentation, deep-link handling, Android/iOS scrolling and home-indicator spacing should be checked on devices. The browser test does not send a real external share.

The existing polling architecture refreshes feeds/categories every 15 seconds, notifications every 10 seconds, and conversations every 4 seconds, with immediate query invalidation after relevant user mutations. No new socket service or remote push delivery was introduced.

Group participation is stored separately from profile likes and romantic consent. Each accepted participant can communicate with the organizer using existing direct conversations; a multi-member group-chat system is not introduced. Existing image fields/media are not removed. Custom category covers are selected by asset key or managed URL; binary uploads are not required for that selection flow.

Live Atlas data and physical devices were not modified or used for test fixtures. The implementation uses the normal configured API/database when the live app runs.

## Existing activities follow-up

A read-only check on October 31, 2026 found four active activities in the configured `along` database: three dated October 27 and one dated November 1. The three earlier plans were excluded by expiry. The initial activity implementation also used the stricter mutual-preference subset instead of the existing Discover visibility filter. This has been corrected while retaining recipient preferences, blocks, location and eligibility checks.

Category responses now include `ownPastCount`. Category cards indicate the owner's earlier plans; the category listing has a **Your plans** filter. `GET /activities/browse?owner=true` includes active plans belonging only to the authenticated user, including earlier dates. Owners may view their earlier plan details and reschedule them with the existing PATCH endpoint; other users still cannot view or join expired plans. The reschedule form preserves an existing positive duration, refreshes live counts, and does not change production dates automatically.

Follow-up verification: all 19 activity/notification regression tests passed, including discovery fallback visibility and owner-only past-plan access/rescheduling. The browser flow also passed owner rescheduling and verified the category's live count changed after the new date was saved. Production data was read for diagnosis only; all mutations in tests used disposable databases.
