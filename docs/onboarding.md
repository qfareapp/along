# Along activity-first onboarding — implementation record

Implemented in the existing mobile app, Express API, shared `User`/`Profile` models and configured Atlas database `along`. The admin panel still uses that same API. No parallel authentication system, duplicate user collection or replacement database was introduced.

## Simplified account entry (10 November 2026)

Welcome now offers Create account and Sign in. New members answer one question per screen: email, password, first name and birthday, then continue into the existing quick start. Returning members enter email and password, then resume their account's progress or enter the app. Each authentication screen includes a progress indicator and Back control that preserves entries. Passwords support autofill and show/hide; email addresses are trimmed and normalized before submission. Validation, adult eligibility and server authentication remain enforced. Preview mode offers a separate Explore the preview entry without registration.

`npm run qa:onboarding` checks account-first registration, invalid input, password visibility, Back preservation, network failure/retry, email normalization, returning-member login and onboarding handoff against an isolated real API/MongoDB, followed by the existing onboarding and eligibility regression flow.

## Run

Use separate CMD windows:

```cmd
cd /d D:\Along
npm run api
```

```cmd
cd /d D:\Along
npm run mobile -- --clear
```

```cmd
cd /d D:\Along
npm run admin
```

Mobile `.env` remains in live API mode. Physical phones must share the computer's Wi-Fi and use its current LAN address in `EXPO_PUBLIC_API_URL`. Check `/ready` on that address if the network changes.

Email delivery is integrated with Brevo's SMTP service. Complete the free account/sender setup in [email-setup.md](email-setup.md). SMTP login, SMTP key and a verified sender are required before real verification codes can be delivered. The app does not mark an email verified if SMTP is missing or delivery fails.

## Phase 1 — inspection and plan

Inspected mobile screens, Expo SDK 58 dependencies, persisted Zustand state, API auth and validation, User/Profile/Activity schemas, admin roles and routes, and existing test suites. Reused the existing theme, bundled imagery, shared API, registration age check, account status, emailVerified field and category slugs. Consulted SDK 58 ImagePicker documentation before installing the compatible package.

Conflicts resolved: the old onboarding only collected categories and basic registration data; existing live accounts were previously allowed to read activities before completing safety eligibility; email verification had a flag but no delivery implementation. The existing registration name/DOB requirements and backend adult validation remain intact. The original quick-start-first path remains compatible with saved drafts; the default welcome flow now creates an account first.

## Phase 2 — backend and MongoDB

Created `apps/api/src/onboarding.ts`, `onboarding.test.ts`, `test-fixtures.ts`, `email.ts`, `email-check.ts`.

Modified `models.ts`, `app.ts`, `config.ts`, existing database/admin tests, package files and environment examples.

- Onboarding is embedded in the existing unique Profile document, with enums, timestamps, step progress and partial updates.
- Existing biography, occupation, account status and other profile fields are retained.
- Authenticated onboarding endpoints validate each required preceding step and make retries safe.
- Completion requires valid vibes, first-plan intent, relationship intent, city and an explicit continue/skip on the optional personality step. It does not publish a plan or activate discovery.
- Eligibility checks compute adult age on the server, require gender, explicit dating preferences and adult age range, contact verification, an owner-bound photo, terms and community consent, and an active account. A client readiness boolean has no effect.
- Profile readiness is recalculated from authoritative account and profile data. Lifecycle stages are synchronized after eligibility, verification and photo changes. Suspension remains in User.status.
- Live activity list/detail/post/edit/interest routes require completed eligibility and discovery activation. Creator eligibility and block rules are applied when reading activities.
- Photo uploads are authenticated, limited to 5 MB and six photos, validated and normalized with Sharp, stripped of metadata and saved privately in the same MongoDB. Reads require ownership or two activated, unblocked accounts. Removing the last photo immediately blocks discovery access.
- Email codes expire after ten minutes, allow five attempts, are stored as keyed hashes and can be consumed once. SMTP secrets stay on the backend.
- Product events contain only a first-party member reference, event name, step, duration and skip flag. They expire after 90 days. No third-party analytics is installed.

Tests: 46 backend tests, including 18 new onboarding tests and the original 28 regression tests. Test databases are isolated in-memory MongoDB instances, never the configured Atlas database.

## Phase 3 — mobile quick start

Created `features/QuickStart.tsx`, `components/onboarding.tsx`, `services/onboarding.ts`, `store/useOnboarding.ts`.

Modified Welcome, Auth, onboarding/index routes, session API helper, root layout and Expo config. Added SDK-compatible `expo-image-picker`.

Welcome → Your Vibe → Your First Plan → The Spark → Your World → Make It You → personalized starter card. The five-step segmented progress bar excludes welcome/completion. Multiple/single selections, checkmarks, disabled required continuation, back navigation, city suggestions/manual entry, optional approximate area, photo selection, optional 160-character prompt, skip and edit controls are functional.

Before an account exists, choices and selected local image URI are saved on the device. After successful registration they are synchronized to the authenticated profile; network failures retain the local draft and provide a retry. A selected pre-account photo is uploaded after authentication through the “Upload Selected Photo” control. Authenticated steps save directly to MongoDB. Returning account holders resume server progress. Sensitive eligibility fields are not included in the onboarding draft.

Selection feedback and screen transitions respect reduced-motion settings. Screens use safe areas, scrollable forms, keyboard handling and the established Along colors. Expired native access tokens can refresh through the existing refresh endpoint.

Tests: TypeScript/lint, mobile browser flow with reload and back navigation, saved selections, optional skips, account creation, Mongo persistence and a failed-save/retry simulation. Screenshots: `docs/onboarding-screenshots/`.

## Phase 4 — mandatory unlock and preview

Created `features/ProfileUnlock.tsx`, `features/AlongHome.tsx`, `app/profile-unlock.tsx`, `app/policies.tsx`.

Modified Discover, Plans, Create/activity/chat/conversation routes and account integration.

Unlock collects display name, birth date matching registration, gender identity, independently chosen dating preferences, age range, explicit consent, email verification and a required photo. Activation remains disabled until the server confirms every check. The server enforces restrictions even if navigation or requests are manipulated.

Incomplete accounts see only clearly labeled inspiration cards and category ideas; no database member profiles or identifying activity posts are fetched. “Complete Profile to Connect” leads to the next required stage. First-plan intent, selected vibes and city personalize the starting screen and category links. Joining, posting and messaging entry points are gated.

Tests: Full browser flow completed email verification through simulated SMTP, uploaded a real image through the API, activated discovery and checked persistence. Backend tests cover underage attempts, consent, incomplete access, photo privacy/deletion, invalid inputs and suspension.

## Phase 5 — progressive profile and admin

Created `features/ProfileEdit.tsx`, `app/profile-edit.tsx`, admin `components/onboarding-analytics.tsx`.

Modified MyProfile, Settings, admin dashboard/user detail pages, Express admin router and shared DTOs.

Optional occupation, education, biography, hobbies, fitness, food, availability, commute window, budget, travel, weekend and lifestyle fields can be edited without blocking activation. Photos can be added/removed. Suggestions have permanent dismiss and seven-day remind-later controls. No interests or private activity history are inferred or published.

Admin dashboard shows started users, completion/conversion rates, server-observed completion time, drop-off by step, vibe/first-plan popularity, pending email verification, ready profiles and event timing/skip/upload outcomes. Relationship aggregates with fewer than five members are suppressed. User details show stage, completed step and safety checklist, without exposing DOB or adding admin overrides for age, consent or preferences. Existing RBAC applies.

Analytics limitations: funnel timestamps measure authenticated server-observed onboarding. Pre-account drafts are local and are not tracked as identifiable server events. Abandonment is a best-effort background event; drop-off counts are persisted incomplete profiles, not proof that a person permanently abandoned the app. Product events are retained for 90 days; aggregate profile counts are all-time. Discovery activation conversion counts historical activations, while the ready count uses current eligibility.

Tests: Admin API state/analytics assertions, production Next build, admin browser regression including dashboard and user details.

## Phase 6 — verification and remaining external checks

Reusable commands:

```cmd
npm --prefix apps/api test
npm run typecheck
npm run qa:onboarding
npm run qa:admin:simple
npm run qa:mobile
```

The onboarding QA command exports a separate web build and exercises an isolated API/MongoDB using simulated SMTP. It never uses the real email provider or creates Atlas test users. The demo regression command exports a separate demo build; it does not change mobile `.env` or production data.

Android and iOS bundles export successfully, and the picker package is included in Expo Go. Physical Android/iOS Expo Go interaction, native keyboard/photo permissions and device-specific upload behavior still require a device test. No attached physical device is available in this workspace. Real SMTP delivery remains pending your Brevo account credentials and sender verification. Existing live matchmaking and chat services remain outside this onboarding implementation; it does not manufacture real matches or conversations.
