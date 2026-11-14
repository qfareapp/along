# Plan group chats

The organiser opens their group plan and chooses **Create group chat**. The group includes the organiser plus the plan's accepted attendees. For 10 accepted requests from 20 applicants, this produces 11 members: the organiser and the 10 selected people. Pending/rejected applicants cannot discover, open or message the group.

The organiser is the sole group admin. **Group members and settings** switches between:

- **Everyone can message**: all current group members may send text, subject to existing account messaging restrictions.
- **Only organiser can message**: attendees can read announcements and history; only the organiser can send. The API enforces this even if a client bypasses the disabled composer.

Groups appear under **Chat > Plan groups**, with a message preview and per-member unread badge. The Chat tab badge includes group unread messages. The member panel labels the organiser as admin. The organiser can choose the initial messaging mode during creation, and change it later. Existing one-to-one chats remain separate.

The accepted-attendee list is authoritative. New acceptances automatically add that person in the same transaction that reserves their plan place. They see their join notice and subsequent messages. Membership cannot be granted to arbitrary users, and the capacity/acceptance logic is unchanged. Existing group chat access is revoked when a member loses selection, either side blocks the organiser, the organiser is suspended, or the plan is removed/paused by moderation. The existing group remains available after a plan's date or organiser-managed completion/closure so members can coordinate.

## Local preview

```powershell
npm run dev:groups
```

Open **http://localhost:18098** in separate normal/incognito browser profiles:

| Role                    | Email                             | Password                |
| ----------------------- | --------------------------------- | ----------------------- |
| Organiser (Alice)       | `play-alice@example.test`         | `Along-play-local-2026` |
| Selected attendee (Bob) | `play-bob@example.test`           | `Along-play-local-2026` |
| Pending applicant       | `group-traveller-20@example.test` | `Along-play-local-2026` |

Alice: **Plans > Travel & Holidays > Weekend mountain trip > Create group chat**. Bob: **Chat > Plan groups > Weekend mountain trip** after creation. The fixture has 20 requests, 10 accepted attendees, and a capacity of 10. All accounts and data are fictional and use a temporary local MongoDB replica set. Restarting the preview creates a fresh test database. The API uses port 4118 and Metro development mode uses port 18098. The web preview requires a fresh login after a full reload because browser tokens are kept in memory.

While the preview is running with fresh data:

```powershell
npm run qa:groups
```

This uses actual organiser, accepted-member, and pending-member browser accounts. It exercises creation, member counts, chat delivery, switching to announcements, attendee read-only access, restoring participant messaging, and hiding the group from a pending applicant. Screenshots use fictional data and are ignored by Git.

## API and persistence

All endpoints require the existing authenticated, activated member session. Responses are private/no-store.

| Method | Path                               | Purpose                                                               |
| ------ | ---------------------------------- | --------------------------------------------------------------------- |
| GET    | `/api/v1/plan-groups`              | Current member's accessible groups and unread counts                  |
| GET    | `/api/v1/plan-groups/for-plan/:id` | Owner/accepted-member group entry and creation eligibility            |
| POST   | `/api/v1/plan-groups`              | Organiser-only creation; duplicate requests return the existing group |
| GET    | `/api/v1/plan-groups/:id`          | Roster and chronological message page; optional `before`/`limit`      |
| PATCH  | `/api/v1/plan-groups/:id/settings` | Organiser-only messaging mode                                         |
| POST   | `/api/v1/plan-groups/:id/messages` | Authorised text submission with an idempotent client ID               |
| POST   | `/api/v1/plan-groups/:id/read`     | Advance only this member's read cursor                                |

`PlanGroup` is unique per plan. `PlanGroupMember` is unique per group/user and stores the join boundary/read cursor. `PlanGroupMessage` has an ordered per-group sequence and a unique group/sender/client ID for safe retries. Creation locks the plan row to serialize against concurrent acceptances; message and settings writes serialize on the group row. Selection, role, messaging restrictions and blocks are checked on every request. Roster data contains display names and roles, without email addresses, phone numbers, or precise locations.

The mobile group screen polls the persisted thread every four seconds while focused and active. The normal chat-list poll updates unread counts, and successful sends/settings changes refresh immediately. History is paginated. This version implements text group chat and in-app unread notifications; it does not add group attachments, calls, OS push notifications, transferable admins, or manual invitations for unselected people. No new native dependency is required. Physical-device testing remains a separate check.

## Files and checks

API: `plan-group-models.ts`, `plan-group-service.ts`, `plan-groups.ts`, `plan-groups.test.ts`, `plan-group-browser-qa.ts`; integration in `app.ts`, `models.ts`, and the existing `acceptActivityInterest` transaction. Mobile: `services/planGroups.ts`, `features/PlanGroupChat.tsx`, `features/PlanGroupEntry.tsx`, `app/plan-group.tsx`; integrations in plan details, Chat list, unread count and plan-refresh hooks. Local fixtures extend the existing isolated Play runner with `--groups`.

```powershell
npm --prefix apps/api run typecheck
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
node apps/api/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 apps/api/src/activities.test.ts apps/api/src/chat.test.ts apps/api/src/notifications.test.ts apps/api/src/plan-groups.test.ts
```

The targeted API suite includes 15 group tests and 32 existing plan/chat/notification regression tests.

Validation: all 47 targeted API tests passed; API and mobile typechecks passed; mobile lint passed. The three-account browser check passed for group creation, attendee chat, organiser-only announcements, restoring messages, and pending-applicant privacy. The local preview was reset afterward for manual testing. After the shared-network rate-limit fix, the affected chat, onboarding, group, game, Social and rate-limit suites also passed (98 tests in total). API typechecking passed again. Physical-device testing and a new APK build remain separate steps.
