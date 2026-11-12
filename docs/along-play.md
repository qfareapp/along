# Along Play: This or That

Along Play lives in **Social > Matches**. Its Play Together card, the floating Social composer, the matched conversation's game-controller button, and the new-match screen all open the same feature. It keeps the five existing bottom tabs.

A member can invite their eligible mutual connections through Social or target one match from a conversation. A play request does not start a game: the host accepts one player, then both players press Ready. The API starts a three-second countdown and serves one question at a time. Answers stay hidden until both players complete the session.

The initial bank contains 100 questions across Lifestyle & Personality, Food & Drinks, Travel & Adventure, Entertainment & Hobbies, and Relationships & Connection. The default game uses three questions per category, shuffled into a persisted 15-question sequence. Recent questions are avoided when enough unused questions remain. Each game keeps its own question snapshots, so later question-bank changes do not alter a past result.

## State and privacy

- `GameDefinition` stores availability, questions per category, invitation expiry, and inactivity settings.
- `GameQuestion` stores the editable bank, including stable seed keys and active status.
- `GameInvitation` and `GamePlayRequest` store invitation/request state. Accepting runs in a MongoDB transaction and claims one invitation and request before creating one session.
- `GameSession` stores the two players, existing conversation, ready state, question snapshots, current index, hidden answers, and final score. Optimistic concurrency retries prevent duplicate progression.
- Existing `SocialNotification` records carry game invitations, requests, readiness, completion, and rematches, respecting notification/mute preferences. Existing `PlanInvitation` records can reference a completed game instead of a Moment.

An active match/equivalent accepted connection and eligible member profiles are required throughout. One-sided likes and pending activity requests do not grant access. Blocks, unmatches, suspension, revoked sessions, or eligibility loss deny game access. Social broadcast invitations also respect Social enablement and hidden-member settings. Targeted chat invitations remain explicit private invitations.

Players never receive the opponent's chosen option before completion. The API returns only the current question, their own answer, and whether the opponent has answered. Results and comparisons are visible only to the two currently authorized participants. An incomplete, abandoned, or timed-out game has no score.

Score: `Math.round(matchingAnswers / totalQuestions * 100)`. Category scores use that category's questions. The game score never changes romantic matching or discovery ranking. The result screen explains that the score is a playful preference snapshot.

## API and real-time transport

All mobile endpoints use the existing `/api/v1/games` prefix and member authentication:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Game definition and public rules |
| GET | `/connections` | Eligible mutual connections |
| GET | `/conversation/:id` | Private game context for a matched conversation |
| GET, POST | `/invitations` | List or publish play invitations |
| POST | `/invitations/:id/cancel` | Close an invitation |
| POST | `/invitations/:id/requests` | Request a game |
| POST | `/requests/:id/accept`, `/requests/:id/decline` | Host response |
| GET | `/sessions` | Authorized history and resumable games |
| GET | `/sessions/:id`, `/sessions/:id/results` | Personalized state or completed results |
| POST | `/sessions/:id/ready`, `/sessions/:id/answers`, `/sessions/:id/leave` | Authoritative progression |
| POST | `/sessions/:id/rematch` | Create a fresh private invitation |
| GET | `/sessions/:id/plan-suggestions` | Available activity suggestions |
| POST | `/sessions/:id/make-plan` | Propose a private plan requiring acceptance |

Socket.IO attaches to the existing HTTP server at namespace `/play`; it does not introduce another server or database. Client events are `game:join`, `game:ready`, `game:answer`, and `game:leave`. Server events include personalized `game:state`, `game:completed`, `game:chat_updated`, `game:player_disconnected`, and `game:error`. Socket authentication reuses access-token validation and checks eligibility for every operation. Idle subscribers are revalidated every ten seconds. On reconnect the client rejoins and receives the persisted authoritative state. HTTP polling remains available as a fallback.

Game chat reuses the existing conversation, message APIs, first-sender rules, read receipts, and messaging restrictions. Chat writes send an authorized invalidation signal over the game socket; they do not create a second message store. The mobile chat drawer is collapsible, shows unread counts, and scrolls to recent messages.

## Admin and deployment

The existing Next.js sidebar has **Along Play**. Its question bank supports adding, editing, deactivating, filtering, and previewing questions, plus active-question counts and game settings. Endpoints are under `/api/v1/admin/games`: `GET/POST /questions`, `PATCH /questions/:id`, and `PATCH /settings`. Existing admin authentication, CSRF, `settings.manage` permission, and transactional audit records protect changes.

The API seeds missing built-in questions on startup with `$setOnInsert`; it preserves operator edits and deactivations. The existing Atlas database must support transactions, as it already does for private plans and moderation. No destructive migration or fixture seeding is needed in production.

Deploy the API commit on Render and the admin commit on Vercel. Install a new mobile APK for the new screens. Keep the existing public API URL and authentication secrets. Native clients use the same HTTPS origin for authenticated WebSocket connections; browser deployments also need their exact origin in the API's `CORS_ORIGINS`.

Default expiry is 30 minutes for an unclaimed invitation and 30 minutes of inactivity for a session. These are independent of 24-hour Moments. Back navigation keeps the session resumable; End game abandons the round for both players. Private plans are created only after the recipient accepts the proposal through the existing Private Plans screen.

The current socket publisher targets one API instance, matching the existing Render deployment. Multiple API instances would need a shared Socket.IO adapter for immediate cross-instance broadcasts; database concurrency safeguards and HTTP reconciliation remain in place. Notifications use the app's existing in-app system; this feature does not enable OS push delivery.

## Validation

Implementation files: `apps/api/src/play-models.ts`, `play-bank.ts`, `play.ts`, `play-sockets.ts`, `chat-events.ts`, `admin/play.ts`, `play.test.ts`, and `play-browser-qa.ts`; `apps/mobile/src/services/play.ts`, `features/AlongPlay.tsx`, and `app/play/*`; `apps/admin/src/components/play.tsx`; and `tools/play-qa.mjs`. Existing API bootstrap, authentication, chat, Social models/notifications and admin routing were extended. Existing mobile Social, chat, match celebration, shared button labels, app version and admin navigation were updated. Package manifests/locks add the JavaScript Socket.IO client and its API test dependency. No new native module was added.

```powershell
npm --prefix apps/api run build
npm --prefix apps/api test
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/admin run build
npm --prefix apps/admin run lint
node tools/play-qa.mjs
```

`play.test.ts` uses an isolated MongoDB replica set and tests eligibility, one-sided likes, privacy, expiry, duplicate requests, concurrent accepts, readiness/countdown, question uniqueness, hidden answers, answer locking/retries, scoring, historical integrity, reconnect state, abandonment, blocks/unmatches/suspension, notifications, rematches, private plan acceptance, admin permissions/audit, and real socket clients. The browser runner uses two independent mobile-sized browser accounts and the actual admin page against a temporary replica set. Its screenshots contain fictional QA users and are ignored by Git. Physical-device testing remains a separate deployment check.
