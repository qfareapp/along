# Along Play: asynchronous matched-chat game

All gameplay lives in the existing matched conversation. Open **Chat**, select a match, and tap **Play** in the chat header. This opens the This or That panel, where you send the invitation (or accept one, play your turn, and see the score). The game is never shown in the chat until Play is tapped; after that, any game activity (an invitation, the other player accepting, an answer, a round reveal, or the final score) opens the panel automatically, even if it was closed. Opening a chat shows the panel straight away when an invitation or your turn is waiting, and a yellow dot on Play marks the same. There is no Social feed entry, floating-composer entry, public game board, separate game room, ready check, or countdown.

1. One member sends a private invitation inside their chat.
2. The recipient accepts or rejects it. Acceptance starts the first question immediately.
3. Either member can answer first, even when their match is away. The answer is persisted and locked.
4. The other member receives a normal chat message/unread badge and can answer when they return.
5. Once both answer, both choices and whether they match are revealed in the chat. The next question becomes available. Completed round results remain in the chat history and the inline previous-answers view.
6. After the final question, both members see the same matching score inside the chat.

Invitations and games do not expire because someone is offline. Leaving the chat preserves progress. Explicitly ending a game abandons it for both players and creates no score. Only one invitation or unfinished game can be active in a conversation. A fresh invitation can be sent after a rejection, cancellation, completion, or explicit ending.

## Local testing only

From `D:\Along`:

```powershell
npm run dev:play
```

Open **http://localhost:18098** in two separate browser profiles, or one normal and one incognito window:

| Account | Email                     | Password                |
| ------- | ------------------------- | ----------------------- |
| Alice   | `play-alice@example.test` | `Along-play-local-2026` |
| Bob     | `play-bob@example.test`   | `Along-play-local-2026` |

These are fictional adults already matched to each other. Choose **Chat** and open the other account's conversation. To simulate being away, close a window or turn off its network, answer from the other account, and come back. The web preview keeps authentication in memory, so a full page reload requires signing in again; game progress stays in the local database. Native authentication still uses SecureStore.

The API runs at `http://127.0.0.1:4118`. Metro serves the app in development mode; no APK, production app build, or web export is needed. Both services bind locally. A temporary MongoDB replica set is isolated from the production database. Stopping the local runner removes all test data. Restart the command for a fresh pair of accounts. No production email, admin credentials, or remote database is needed.

Run the browser check while this preview is running, using a fresh local database:

```powershell
npm run qa:play
```

It uses two independent browser accounts against the running development preview and checks direct requests, offline invitation delivery, rejection, acceptance without ready checks, offline turns, round reveals, final scoring, ordinary chat, and absence of a Social game entry. It leaves the test game completed; restart the preview if you want a clean chat.

## Implementation

- `apps/mobile/src/features/ChatPlay.tsx`: invitation controls, current question, saved-choice waiting state, per-round reveals, history, final score and explicit ending, all embedded in `LiveConversation`.
- `apps/mobile/src/features/LiveChat.tsx`: Play control in the existing matched-chat header and game card inside the message scroll view.
- `apps/mobile/src/services/play.ts`: personalized state, authenticated API actions, socket updates and HTTP polling fallback.
- `apps/mobile/src/features/AlongPlay.tsx`: redirects old game links to their owning conversation. Previous Social/new-match game entries are removed.
- `apps/api/src/play.ts`: direct invitation acceptance/rejection, transactional game progression and chat notices. No online-presence gate or inactivity expiration.
- `apps/api/src/play-models.ts`: direct invitations carry their conversation and recipient; a unique partial index prevents duplicate open invitations for the same conversation.
- `apps/api/src/models.ts` and `chat.ts`: existing Message records carry game event metadata. The existing chat preview, unread count and read receipts provide notifications. A unique event key deduplicates retries.
- `apps/api/src/play-local.ts` and `tools/play-local.mjs`: isolated two-account local preview. The local fixture entry point is excluded from production TypeScript output.
- `apps/api/src/play.test.ts` and `play-browser-qa.ts`: state/privacy/concurrency and browser checks.

The question bank retains 100 questions in five categories, with 15 questions per game by default. Questions are snapshotted when the recipient accepts. The admin can manage questions and availability; old invitation/resume duration settings are hidden and no longer gate chat games. The old request/ready data fields are retained for existing records, but the new flow does not use them. An older accepted session in the waiting state resumes as playing.

## API and privacy

All game endpoints use existing member authentication under `/api/v1/games`:

| Method | Path                       | Purpose                                                          |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| GET    | `/conversation/:id`        | Private invitations, current game and results for a matched chat |
| POST   | `/invitations`             | Send directly to `recipientId`; broadcast requests are rejected  |
| POST   | `/invitations/:id/accept`  | Recipient accepts and starts the game                            |
| POST   | `/invitations/:id/decline` | Recipient rejects                                                |
| POST   | `/invitations/:id/cancel`  | Sender cancels                                                   |
| GET    | `/sessions/:id`            | Personalized current state and completed-round reveals           |
| POST   | `/sessions/:id/answers`    | Submit immutable `questionIndex` and `choice`                    |
| POST   | `/sessions/:id/leave`      | Explicitly end the game                                          |
| GET    | `/sessions/:id/results`    | Final results after all questions                                |

Socket.IO still uses the existing HTTP server and `/play` namespace for fast updates when a chat is open. HTTP polling and persisted state allow asynchronous play without a connected socket. Both answers are revealed only for completed rounds. Pending opponent choices are never included in personalized state or turn notices. The final score is `Math.round(matchingAnswers / totalQuestions * 100)` and does not affect discovery or matching rankings.

Every operation requires the existing active match, eligible profiles, two-way block checks and chat messaging rules. Blocks, unmatches, suspensions and session revocation remove access. Requests, responses, answer persistence and chat notices use transactions and optimistic concurrency to avoid double acceptance, duplicate messages and double progression.

Game notices are chat messages only. New game events do not create Social notifications; legacy Social game notifications are filtered out. This work does not enable operating-system push notifications. Native physical-device testing remains outstanding. The APK release uses the existing production API URL. Deploy the matching API commit on Render before testing the new chat flow, and deploy the admin changes on Vercel. The local test runner remains isolated from production.

## Checks

```powershell
npm --prefix apps/api run typecheck
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
npm --prefix apps/admin run typecheck
node apps/api/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 apps/api/src/chat.test.ts apps/api/src/social.test.ts apps/api/src/play.test.ts
```

Validation completed locally: all 55 targeted game, chat and Social API tests passed; API, mobile and admin typechecks passed; mobile lint passed; the full two-account browser scenario passed with 14 of 15 matching answers (93%). These checks ran before preparing the release APK.
