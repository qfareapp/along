# Along Communities

Communities extend Along Social without another bottom tab, database, matching system or authentication flow. The Social floating people button opens a community picker. Selecting a joined community opens its chat; other users see a preview and an explicit Join action. Add Status remains available in the Social header. Communities expose Chat, Events and Members.

## Setup and adding groups

The production API (`src/index.ts`) and local development entry points idempotently initialize six groups: TravelAlong, JamAlong, MusicAlong, FoodAlong, PlayAlong and FitAlong. Seed operations use `$setOnInsert` and preserve administrator edits, archives and custom communities.

For an already configured database, run from `apps/api`:

```powershell
npm run communities:seed
```

The admin sidebar has **Communities**. **Set up initial communities** safely adds missing initial groups. **Add community** creates an additional interest group. Edit the name, unique slug, category, approved icon, description, rules, HTTPS cover URL, visibility, status, per-organiser plan limit and per-member message rate. Existing category illustrations provide cover fallbacks. No new broad image or storage permissions are needed.

The mobile app and admin must use the updated API. An old API deployment cannot serve the new routes; an existing APK does not acquire new screens until rebuilt or updated using the app's established release process. This implementation does not itself publish a deployment or build an APK.

## Eligibility and verification

All member endpoints use Along authentication and `requireReady`, including adult-account and profile eligibility. Joining, chatting, creating a community plan and requesting participation **do not require Amazon verification**, as explicitly requested. No AWS SDK, credentials, biometric collection, fake verification success or new Face Verified badge is introduced. Future verification should be integrated into the shared plan creation/participation services after a real authoritative provider flow exists.

## Models and indexes

All collections share the configured MongoDB connection:

- `Community`: unique slug, active/archived, public/hidden, member counter, sequence, revision, rules, cover and configurable limits.
- `CommunityMembership`: unique `(community,user)`, member/moderator/admin role, active/left/suspended/banned status, joined/read sequence boundaries, notification mute and moderator messaging timeout. User/status and community/status pagination indexes.
- `CommunityMessage`: text, reply reference, deletion/pin state, unique `(community,sequence)` and `(community,sender,clientId)` indexes.
- `CommunityReaction`: unique `(message,user)`; setting a reaction is idempotent and null removes it.
- `CommunityModerationAction`: scoped actor, target, action and reason.
- `CommunityNotice`: unique delivery key, recipient pagination and 30-day expiry.
- Existing `ActivityPost`: optional community, approval/open participation policy, idempotent submission key and reminder marker. Community/status/date and submission uniqueness indexes.
- Existing `ActivityInterest`: pending, accepted, declined, cancelled and waitlisted. Existing activity/user uniqueness and atomic capacity reservation are preserved.
- Existing `PlanGroup`, `PlanGroupMember`, `PlanGroupMessage`: event rooms with mute, reply, pin and deletion support; `PlanGroupReaction` adds unique message/user reactions.

A community needs a separate message collection because existing direct conversations depend on dating/activity consent and existing group conversations are bound to a particular plan. Sharing membership must never manufacture a Match or direct Conversation.

## Membership, privacy and moderation

Join/leave operations serialize on the community in a MongoDB transaction, so retries and concurrent changes cannot duplicate membership or drift its counter. Rejoining starts a new history boundary; messages sent while away are not exposed. Banned/suspended members cannot rejoin. A moderator's messaging pause lasts 24 hours; suspension/ban is restored explicitly through moderation.

Leaving the main community preserves previously approved event participation. Joining a community does not join event rooms. Community bans and platform bans revoke access. An organiser can remove event participants; this releases capacity and revokes event chat access. An ordinary event departure can be requested again, but an organiser-declined participant cannot simply bypass that decision. Standalone group removal keeps its prior behaviour.

Member previews expose display name, main profile photo and community role. Opening the existing profile screen still uses existing privacy and Like/Vibe Check rules. Emails, phone numbers, dates of birth, precise locations and private dating conversations are never included. Blocks hide messages, quoted messages, reactions and roster entries; unread counts exclude blocked senders. Socket packets contain only invalidation IDs, never broadcast message bodies that could bypass per-recipient block rules.

Moderators can review scoped reports, resolve reports with a reason, remove messages, pin announcements, pause messaging, suspend/ban ordinary members and remove unsafe plans through scoped APIs. They cannot change another moderator or inspect unrelated dating chats. Platform admins use existing CSRF-protected authentication and permissions (`settings.manage`, `reports.review`, `activities.moderate`). Changes are recorded in CommunityModerationAction or the platform audit log. Child-safety reports retain the existing critical-priority handling. Account deletion removes community messages, reactions, memberships, notices and read state and adjusts counters; limited existing safety-report retention remains applicable.

## Event Hub

Community events are existing Along plans with an optional community link. The existing Create Plan form, plan cards, details and plan-group screens are reused. Community creation requires a dated group plan and uses a stable client submission ID. The default limit is three active plans per organiser per community, configurable in admin. Creation and reopening enforce the limit under a community write lock.

Upcoming, For You, Popular and My Events use backend pagination. For You uses existing profile interests/vibe categories, not a dating-preference ranking. Filters include title, category, city/general area, date, available seats and participation policy. General browsing requires no GPS; an organiser's explicitly chosen age/gender/distance audience still applies. Similar-plan suggestions compare title words, date and optional area; they warn without blocking legitimate new plans.

The Event Hub prevents chat flooding: creating 50 plans produces **zero automatic main-chat announcements**. Each plan is listed independently with its own participant state and chat. Opening the hub does not fetch every event's chat history.

Open RSVP reserves a place atomically; a full plan creates a waiting-list entry. Approval plans require the organiser's explicit approval. Requested/waitlisted users cannot read an event chat. Removing a participant releases the seat. When a seat opens on an open plan, the oldest active-community waiting member receives an invitation to confirm; they are not silently enrolled. The existing capacity convention counts attendees separately from the organiser.

Community event groups are created automatically upon the first approved attendee. Only the organiser and accepted attendees receive membership; new attendees cannot read earlier history. Leaving the community does not expose any additional event history. Cancelled/closed/archived plans close event chats. Completed plans keep readable event chats but cannot send or accept new participation; after 30 days the existing expired state closes them. The production minute worker handles completion, archival and a single reminder within an hour of the start. An always-running API is needed for timely reminders; sleeping hosts delay them.

## REST endpoints

All paths below are relative to `/api/v1`:

| Method    | Route                                                         | Purpose                                                                |
| --------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| GET       | `/communities?scope=all                                       | mine                                                                   | suggested&q=&cursor=` | Discover paginated groups |
| GET       | `/communities/:id`                                            | Summary, unread and membership                                         |
| POST      | `/communities/:id/join`, `/leave`                             | Explicit membership                                                    |
| PATCH     | `/communities/:id/preferences`                                | Mute community alerts                                                  |
| GET       | `/communities/:id/members?q=&cursor=`                         | Paginated member roster                                                |
| GET, POST | `/communities/:id/messages`                                   | History and idempotent sends                                           |
| POST      | `/communities/:id/read`                                       | Monotonic read sequence                                                |
| POST      | `/communities/:id/messages/:messageId/react`, `/pin`          | Reaction and moderator pin                                             |
| DELETE    | `/communities/:id/messages/:messageId`                        | Sender/moderator deletion                                              |
| GET       | `/communities/:id/plans`                                      | Paginated Event Hub                                                    |
| GET       | `/communities/:id/plans/similar`                              | Nonblocking duplicate suggestions                                      |
| POST      | `/activities`                                                 | Existing plan creation with communityId, clientId, participationPolicy |
| POST      | `/activities/:id/interests`                                   | Existing participation entry point                                     |
| GET       | `/communities/:id/plans/:planId/participants`                 | Organiser request management                                           |
| POST      | `/communities/:id/plans/:planId/participants/:userId/approve` | Atomic approval                                                        |
| DELETE    | `/communities/:id/plans/:planId/participants/:userId`         | Leave/remove participation                                             |
| POST      | `/communities/:id/report`                                     | User/message safety report                                             |
| POST      | `/communities/:id/members/:userId/moderate`                   | Scoped moderation                                                      |
| GET       | `/communities/:id/reports`                                    | Scoped moderator queue                                                 |
| POST      | `/communities/:id/reports/:reportId/resolve`                  | Audited resolution                                                     |
| POST      | `/communities/:id/plans/:planId/remove`                       | Scoped plan moderation                                                 |
| GET, POST | `/communities/notices`, `/communities/notices/read`           | In-app updates/read state                                              |
| PATCH     | `/plan-groups/:id/preferences`                                | Event-chat mute                                                        |
| POST      | `/plan-groups/:id/messages/:messageId/action`                 | Event reactions, pin and delete                                        |

Existing plan-group chat, plan details, editing and status routes remain in use. Admin routes live under `/api/v1/admin/communities`: list/create/seed/edit, paginated member management, scoped reports, message removal and plan moderation.

## Real-time transport

The existing Socket.IO server gains a `/communities` namespace. It supports `community:subscribe`, `community:unsubscribe`, `community:message:send`, `community:changed`, `community:access-revoked`, `event:subscribe`, `event:changed`, and `event:access-revoked`. Event subscriptions use the existing PlanGroup ID and remain protected by its authoritative authorizer. Subscription and send acknowledgements report success/failure. REST writes and socket sends share validation/idempotency rules. JWT/session validity is checked on actions and delivery; periodic checks recover missed access changes. Reconnection invalidates and refetches authorized paginated history. Mobile disconnects live community listeners when unfocused/backgrounded and retains bounded polling as recovery.

Rooms are `community:<communityId>` and `event:<groupId>`. No additional Socket.IO server is created. Before multiple API instances are introduced, add a shared Socket.IO adapter/invalidation transport and coordinate background jobs; the initial implementation uses the existing single-instance architecture.

## Notifications

Community welcome, replies, plan requests/approval, participation removal, time/location changes, cancellation and reminders appear as durable in-app updates. Community chat pushes are reply-focused to avoid alerting every member to every message. Event chats use the existing message notification delivery. Community and individual event-chat mutes are checked again at delivery. New event creation never notifies the entire community.

Message pushes identify the sender and say to open Along; actual message text is not placed on the lock screen. Other community pushes retain **Along / 1 new notification from Along** and open Community Updates. Existing FCM/EAS configuration is reused. No new push provider or credentials are added.

## Validation and release

Run API tests with the existing Node/tsx test framework and MongoMemoryReplSet. `src/communities.test.ts` covers seed idempotency, adult unverified membership, concurrency, access boundaries, blocking, replies/reactions, moderation, report priority, creation limits, RSVP capacity, waiting lists, event-room access, cancellation, deletion and socket authorization. Existing plans, groups, push, safety, Social and notification regressions must also pass. Run API/admin/mobile typechecks, mobile lint and available exports/builds.

Deploy the updated API and admin, then release an updated mobile bundle/APK through the established process. Verify the list has six groups, join two test accounts, exchange chat messages, create/approve a plan, check event chat and removal, and test real-device push delivery. No claim of Play approval, production load capacity or native-device QA follows from source checks alone. Amazon verification remains intentionally deferred.

### Checked in this implementation

- The six initial groups were seeded successfully in the configured database without overwriting existing settings.
- The combined Communities, plan groups, notifications, Social, safety and push run passed 91 tests. Another 34 shared-plan/audience/expiry/account-deletion regressions passed. The final expanded community/legacy-notification run passed 24 tests, including 20 community scenarios; push delivery uses a fake provider and also checks repair after an enqueue failure.
- Phone (390px) and tablet (820px) browser QA passed the floating picker, six-group list, joining, chat, replies, Event Hub, filters, members and retained Add Status flow. Fixtures intercept API/socket traffic; no fictional browser content was written to production.
- API, mobile and admin typechecks, mobile lint, web/Android exports and the Next admin production build passed. A native APK/EAS build and deployment were not started by this task.
- The installed Next.js version emitted a security advisory during the admin build. The retry completed but retained the upgrade recommendation. A dependency security upgrade remains outstanding; this feature did not change Next.js versions or claim to resolve that advisory.
