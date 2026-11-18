# Discover Vibe Check

Members can set up an optional Vibe Check from **Profile → Your Vibe Check** or the sparkles button in the Discover header. Other members see a Vibe Check action on an enabled Discover card and profile. Like, save and pass remain available. This is separate from the asynchronous game inside matched chats.

After a member first finishes profile safety/photo checks and activates Discovery, they see an optional **Set up your Vibe Check?** prompt. **Do it now** opens the existing editor; saving continues into Along. **Later** goes straight into Along without creating or enabling a Vibe Check. The editor also offers Later when opened from this prompt. Existing activated members editing profile preferences keep their usual flow, and Profile retains its setup/edit entry.

The preset bank contains exactly the 20 questions and A/B choices supplied for this feature. Select any number from 1 to 20 total questions, combining presets and custom multiple-choice questions. Custom questions support 2–4 distinct choices, a 180-character prompt, and 80 characters per option. Each selected question requires a private owner answer. Preset content is canonical on the server.

The threshold slider runs from 0–100%, in steps of 1. Fine-adjustment buttons also support precise and keyboard-accessible changes. Every question has equal weight. A passing result uses `matchingAnswers * 100 >= threshold * totalQuestions`; displayed rounding never decides eligibility. For example, 70% of five questions needs four matching choices; two of three is displayed as 66.7% and fails a 67% threshold. Zero means any completed check passes.

Automatic matching is **off by default** and has an explicit consent switch. When enabled, a passing attempt creates a normal Match and Conversation without requiring likes. Otherwise it becomes a pending request; only the owner can accept or decline it. Acceptance opens chat. Failure or rejection creates no match. A passing score measures shared choices, not relationship compatibility.

## Privacy and lifecycle

- Member authentication and activated profile eligibility are required. Existing Discover visibility, blocks, account status and messaging restrictions apply. A check cannot revive an unmatched connection.
- Owner answers are private. Public question, discovery, result and notification DTOs never include answer keys or submitted choices. The owner settings endpoint returns only that owner's key. Scores are computed on the server.
- Each visitor gets one submitted attempt per owner/check revision. An identical retry returns the existing result; changed answers are rejected. Concurrent submissions cannot create duplicate attempts, matches, conversations or result notices.
- Saving questions/settings starts a new revision. Stale submissions and stale settings writes are rejected. Old pending requests expire; existing chats remain available. Historic scores remain in the participant's results.
- MongoDB transactions serialize submissions and approvals with settings edits. A replica set is required, as for existing transactional plan/game features.
- Both participants have private read positions in the results inbox. The notification bell includes unread Vibe Check results; matching also adds one shared chat result notice. Results and approval requests are under **Notifications → Vibe Check results** or **Your Vibe Check → Results & requests**.
- Custom question reporting uses the existing member safety/report flow. This implementation does not add OS push notifications.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/vibe-checks/mine` | Owner settings, private answers, and the 20 presets |
| PUT | `/api/v1/vibe-checks/mine` | Save a version with optimistic concurrency |
| GET | `/api/v1/vibe-checks/profiles/:id` | Public questions, cutoff, own result, existing chat |
| POST | `/api/v1/vibe-checks/profiles/:id/attempt` | Validate, score and submit one attempt |
| GET | `/api/v1/vibe-checks/inbox` | Current member's private results and passing requests |
| POST | `/api/v1/vibe-checks/attempts/:id/decision` | Owner acceptance/rejection |
| POST | `/api/v1/vibe-checks/attempts/:id/read` | Mark only this participant's notification read |

Writes have a per-member quota of 30/minute in addition to the app's normal limits. The public discovery card contains only availability, question count, threshold and matching mode. An existing active match is recognized by profile details, and matched users leave the Discover suggestion deck.

## Local checks

```powershell
npm --prefix apps/api run typecheck
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run lint
node apps/api/node_modules/tsx/dist/cli.mjs --test --test-concurrency=1 apps/api/src/vibe-checks.test.ts apps/api/src/chat.test.ts apps/api/src/play.test.ts
```

Run `npm run dev:groups` for the isolated API (`127.0.0.1:4118`) and web preview (`localhost:18098`), then `npm run qa:vibes` in another terminal. The browser check uses only fictional fixture accounts, configures preset and custom questions through the real UI, moves the slider, submits a passing check from Discover, opens chat and verifies the owner's notification. Restart the isolated runner before repeating a completed browser run, because the first run creates a real match inside its temporary database. Screenshots are ignored under `docs/vibe-check-screenshots/`.

For manual testing, use `play-alice@example.test` to create a check and `group-traveller-20@example.test` to answer it, in separate browser profiles. Both use the fictional fixture password `Along-play-local-2026`. Alice and Bob are already matched in the group/game fixture, so use a traveller account to test a new Vibe Check connection. None of these accounts are production accounts.

Validation: 16 Vibe Check tests and 28 existing chat/game regression tests passed. API and mobile typechecks, mobile lint, and the two-account browser flow passed. The isolated preview is reset after browser testing for manual use.

`npm run qa:vibes:onboarding` checks the post-activation prompt, Later, setup-now/save, deferring from the editor, and the unchanged Profile entry. It uses only fictional loopback fixtures and intercepts the initial completion response to represent a just-completed profile; login, activation and Vibe Check saves still use the real local API. These navigation checks, mobile typechecking and mobile lint passed.

The SDK-compatible slider dependency is `@react-native-community/slider` 5.2.1. It is available in Expo Go; installed APKs need a new native build to include this dependency. This change does not build, publish or deploy an app. Physical-device validation remains separate from browser and API checks.
