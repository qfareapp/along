# Along Social implementation

Social replaces the Post tab on phone and the tablet sidebar. Plans → Start a plan opens the existing category-specific plan composer at `/create`, now a regular stack screen with Back navigation. The composer is outside the tab navigator because Expo Router 58 redirects away from hidden tabs.

## Integrated behavior

- The Social feed mixes live public plans and status updates in one newest-first list. Matches shows eligible matched organizers' plans; Discover uses the existing Discover author filters. Own public plans remain included. Plan cards reuse the existing save action and plan detail screen, including dates, approximate area, capacity and request state. Plans follow their schedule rather than the 24-hour status expiry. Private, paused, expired, deleted and unavailable plans stay out, with existing category, organizer and plan-audience checks enforced on the server. Muted and hidden organizers are filtered too.
- Text, photo, Spark Question and Along Now Moments, published for exactly 24 hours using server time.
- A two-option toggle switches both the tray and paginated feed between Matched connections (default) and Discover preferences. The latter uses Discover's mutual age/gender preference filter and the viewer's city or saved distance radius, without excluding people merely because they were swiped on. Own updates remain visible in both modes. Unseen/viewed rings, story segments, previous/next controls, pause/resume, automatic advance and pull-to-refresh are supported.
- Heart/emoji reactions with optimistic updates; a unique reaction per member and Moment. The author can see eligible viewers and reactions; other matches cannot.
- Private replies and authorized shares use the existing Match, Conversation and Message records. Replies do not create public comment threads or duplicate conversations. Activity connections preserve the activity owner's first-message requirement.
- All My Matches, Discover matches, Close Circle and Only Me audiences. Discover matches is an explicit publishing/default-audience choice: preference-compatible people can see those updates without an active connection. Existing posts and the default publishing audience remain match-only. Author exclusions, globally hidden matches, muting, Social visibility, view receipts, notification preferences, reshare defaults, deletion and private archives still apply.
- In-app notifications use the existing notification bell and notification center entry point, with a Social updates view. There is no lock-screen content or new push integration.
- Make a Plan prefills a suggestion, requests category/date/time/approximate area, then sends a private invitation. Accept, Decline and Suggest Changes are supported. A version check prevents acceptance of obsolete proposals. Acceptance creates an existing ActivityPost with `visibility: private`; both people can find it in Your plans and Social private plans. Public feeds, category counts and profile plan lists exclude it. Agreed plan details cannot be silently edited by one person.
- Social Moderation in the existing admin panel lists reported Moments. A moderator must supply a reason before opening content; reads, media access and decisions are audited. Moderators can remove, dismiss or escalate. Existing account suspension, safety reports and support workflows remain available.

## Authorization and expiry

All mobile endpoints require existing bearer authentication and completed, activated onboarding. Social connections come only from active existing Match records, for eligible active adults, with no block in either direction. A one-sided like, pending request or group participation alone never grants access to match-only posts. Accepted activity connections qualify through their existing explicit Match. Discover-shared posts also authorize eligible people who currently match Discover preferences, with no block and Social enabled. This authorization is checked on details and media as well as feeds. It does not create a Match or conversation; private replies and plan invitations still require an existing connection.

The server reevaluates connection or Discover compatibility, account status, Social settings, audience and expiry on reads, media downloads and mutations. Unmatching revokes match-only access; blocking, suspension, lost eligibility, hidden-audience changes and deletion revoke server access. Sharing cannot expand an audience and requires an existing usable conversation with the recipient.

Visibility checks use `expiresAt > now`, so expiry does not depend on the cleanup timer. `index.ts` runs cleanup every minute, marking expired records. Removed content and opted-out archives can be deleted after 30 days; reported evidence is retained. Enabled creator archives are retained privately. There is no TTL index on Moments that could destroy evidence. Notification records expire after 30 days.

The client checks expiration every second and refreshes active content about every ten seconds. Server revocation is immediate on the next request. Already downloaded pixels cannot be remotely erased from a user's memory or screenshots.

## Storage and deployment

This uses the existing Mongoose connection and configured database. No duplicate users, matches, activities or conversations are created. Tests use isolated MongoMemoryReplSet databases, never the configured deployment database.

JPEG/PNG/WebP uploads are limited to 8 MB and 40 million decoded pixels, normalized to JPEG at up to 1440 × 1920, and stripped of embedded metadata. The API performs the upload for the authenticated author; clients cannot claim another user's asset identifier.

Configured Cloudinary uses the existing authenticated image storage service. Signed provider URLs remain inside the backend; clients download bytes through the authorized Moment media endpoint with `private, no-store` caching. For local development without Cloudinary, `SOCIAL_MEDIA_DIR` defaults to `.social-media` and contains private files outside any static route. Use authenticated Cloudinary in production, or provide persistent private filesystem storage for the local adapter. Large media is not stored in MongoDB.

No new native dependency is needed. Supported text/photo interactions use existing Expo SDK 58 packages, including Expo Go-compatible ImagePicker. Physical-device Expo Go behavior still needs device QA; Android/iOS bundle export is a build check, not a device test.

Native multipart uploads use XMLHttpRequest, which supports React Native file URI parts. Expo 58's default fetch rejects those parts with `Unsupported FormDataPart implementation`; JSON requests and browser uploads still use fetch. Uploads retain session refresh/retry handling and have a 45-second timeout. Run `npm run test:uploads` to reproduce the installed Expo converter failure and check native transport selection, multipart headers, retries, cancellation and timeout behavior.

## Models and indexes

| Model              | Purpose and indexes                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| SocialMoment       | Content/audience/publication metadata; author + status + expiry + descending ID, status + expiry |
| MomentReaction     | Unique Moment + user                                                                             |
| MomentView         | Unique Moment + user; personal seen state with optional author-visible receipt                   |
| SocialSettings     | Unique user; current privacy controls                                                            |
| SocialNotification | Unique deduplication key, recipient + descending ID, 30-day TTL                                  |
| PlanInvitation     | Versioned private proposal; recipient + descending ID, proposer + descending ID                  |

Existing ActivityPost gains `visibility` (legacy records remain public). Existing Message gains `socialMoment` and `socialKind` reference fields and a sparse socialMoment + createdAt index. Existing Report gains a Moment reference with a sparse index for evidence retention lookups. Message remains the authoritative private reply content.

## API routes

All below are under `/api/v1/social`.

The app requests `/feed?includePlans=true` for the mixed feed. Each item has an `id`, a `kind` (`moment` or `plan`) and the corresponding `moment` or `plan` payload. Both types share the descending-ID cursor so pagination does not repeat or skip one type. Without this option, the endpoint retains its original status-only response for other callers. The tray remains status-only.

| Method      | Route                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET         | `/feed?scope=matches\|discover&before=&limit=&author=`, `/tray?scope=matches\|discover`, `/connections`, `/categories` |
| POST        | `/moments` (JSON or multipart photo + JSON payload)                                                                    |
| GET, DELETE | `/moments/:id`                                                                                                         |
| GET         | `/moments/:id/media`, `/my-moments`, `/my-archive`                                                                     |
| PATCH       | `/moments/:id/audience`                                                                                                |
| POST, GET   | `/moments/:id/views` (GET author only)                                                                                 |
| PUT, DELETE | `/moments/:id/reaction`                                                                                                |
| GET         | `/moments/:id/reactions` (author only)                                                                                 |
| POST        | `/moments/:id/replies`, `/moments/:id/share`, `/moments/:id/report`                                                    |
| GET         | `/moments/:id/share-recipients`                                                                                        |
| POST        | `/moments/:id/make-plan`, `/invitations/:id/respond`                                                                   |
| GET         | `/invitations`, `/notifications`                                                                                       |
| POST        | `/notifications/:id/read`                                                                                              |
| GET, PATCH  | `/settings`                                                                                                            |

Admin routes under `/api/v1/admin/social`: GET `/analytics` (`analytics.read`); GET `/reports`, `/reports/:id?reason=`, `/reports/:id/media?reason=` and POST `/reports/:id/moderate` (`reports.review`). Existing HttpOnly session, origin and CSRF controls apply. Private content is available only through a reported item, not a general Moments browser.

## Files

New backend: `apps/api/src/social.ts`, `social-models.ts`, `social-storage.ts`, `social.test.ts`, `social-browser-qa.ts`, `admin/social.ts`.

New mobile: `features/Social.tsx`, `services/social.ts`, the `(tabs)/social.tsx` route and `moment`, `moment-create`, `moment-share`, `moment-archive`, `social-settings`, `social-plan`, `social-invitations`, `social-updates` routes. The existing `(tabs)/create.tsx` route moved to `app/create.tsx`; all Plans entry points now open the stack composer. Successful publication replaces the composer with plan details, so Back returns to Plans.

New admin: `apps/admin/src/components/social.tsx`. New validation runner: `tools/social-qa.mjs`. Later-phase shared-memory contract: `packages/shared-types/social.ts`.

Modified integration points: API app/router, models, startup cleanup, activities, discovery, chat and admin router; mobile tab layout, authenticated image/API transport, chat, notification center, settings and activity details; admin navigation/module routing; QA entry points and environment/storage documentation.

## Verification

- `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 src/social.test.ts src/chat.test.ts src/activities.test.ts src/notifications.test.ts` from `apps/api`.
- Full `npm test` from `apps/api`: **129 tests passed**, including 16 Social tests and existing admin, onboarding, discovery, activity, media and chat coverage.
- The final Social rerun passed **17 tests**, including the added cleanup regression: retained archives and reports do not prevent eligible old content from being deleted. Scheduled cleanup also prevents overlapping runs.
- `npm run qa:plans -- --posting-only`: **all 12 categories passed** through Plans → Start a plan, with category validation, draft retention, publication, persisted fields and public summaries. This focused mode avoids the older full scenario's unrelated multi-session timing assumptions.
- `npm run qa:social` from the root exports web and tests actual text/photo publication, tray/feed, reaction, private reply, consent-based invitation acceptance and private activity detail, privacy settings, phone/tablet layout and browser errors. Screenshots: `docs/social-screenshots`.
- Mobile and API typechecks, mobile ESLint without cache; admin TypeScript without incremental output when the existing tsbuildinfo file is locked.

## Deferred features and practical limits

- **Video Moments are not implemented.** The API rejects video and the composer does not advertise it. A production implementation needs private video processing, duration/size validation, thumbnails, playback lifecycle and authenticated streaming. Expo Go-compatible video playback exists; no claim is made that video inherently requires a development build.
- **Our Moments is contract-only.** `packages/shared-types/social.ts` defines participant-only shared-memory drafts, two explicit consents and withdrawal. There is no shared-memory publishing UI or persistence yet.
- **No Socket.IO transport is active in the repository.** A server dependency is installed, but existing chat uses polling. Social follows that authenticated polling and query invalidation pattern. No socket server or push notification dependency was introduced.
- The archive returns the most recent 50 retained Moments, the tray up to 100 authors, and viewer/reaction lists up to 200 eligible matches. Feed pagination is implemented. Publishing is limited to 20 per hour per IP and 20 active Moments per author; mutations have their own limiter in addition to the application limiter.
- The viewer has previous/next buttons and timed advance; gesture navigation is not implemented. Only Me is a published private 24-hour Moment, not an editable draft workflow.
- Analytics report actual aggregate counts; daily viewers counts viewers, rather than claiming to measure every possible Social visit. Reported private reply review and a dedicated Social appeals UI are not added; existing safety/support workflows remain in place.
