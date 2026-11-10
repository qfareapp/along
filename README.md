# Along

**Same plans. Better together.**

[![Deploy API and admin to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fqfareapp%2Falong)

The Render Blueprint deploys the API and admin dashboard as separate services. See [Render setup and required environment values](docs/deployment.md#render-api-and-admin-dashboard).

An Expo React Native application built from the supplied Along UI showcase: deep teal, coral, ivory, peach, rounded activity cards, large discovery imagery and five-tab navigation. The exact illustration and photo regions were extracted from the supplied reference for the local preview. Source images are small, so original high-resolution assets will be needed for production-quality imagery. The logo is a native text/icon reconstruction, not the original logo font.

## Activity-first onboarding

The mobile app now includes a five-step activity-first quick start, saved progress, a private preview, mandatory profile unlock, verified-contact/photo requirements and server-enforced discovery access. The admin dashboard and user details include onboarding analytics and eligibility checks. See [implementation and verification](docs/onboarding.md) and [free Brevo email setup](docs/email-setup.md). Run `npm run qa:onboarding` for the isolated end-to-end test.

Photo uploads normalize images to JPEG before multipart transfer and use Cloudinary automatically when its backend credentials are configured. See [photo upload setup and troubleshooting](docs/photo-uploads.md).

## Admin panel setup

The integrated Next.js admin panel uses the existing Express API and the same MongoDB database. It includes roles, live metrics, users, verification review, activities, categories, reports, matching settings and audit logs. Temporary email/password login is configured in `apps/api/.env` through `ADMIN_AUTH_MODE=env`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (6+ characters). Run `npm.cmd run api`, then `npm.cmd run admin` in another terminal and open http://localhost:3000. The original MFA flow remains available with `ADMIN_AUTH_MODE=mfa`.

See [admin setup, security and remaining phases](docs/admin-setup.md) for durable Atlas setup, mobile integration and verified functionality. No default admin credentials or disconnected dashboard demo are provided.

## Run the app

Discover shows swipeable member profiles; Plans shows activity posts. Likes, passes and saved profiles persist through the shared API. See [discovery behavior and eligibility](docs/discovery.md).

Node 22.13+ is required. Dependencies are installed in each project with committed lockfiles. On Windows PowerShell, use `npm.cmd`/`npx.cmd` if script execution policy prevents `npm`/`npx`.

```powershell
cd D:\Along
npm.cmd ci
npm.cmd --prefix apps/mobile ci
npm.cmd --prefix apps/api ci
npm.cmd run mobile
```

Open the QR code with **Expo Go compatible with SDK 58**, with your phone and computer on the same Wi-Fi. Press `w` for web preview, or run `npm.cmd run web`. Expo SDK 58 includes React Native 0.88 and React 19.3. Version sources: [SDK reference](https://docs.expo.dev/versions/v58.0.0/) and [Expo Go](https://expo.dev/go).

The default is an explicitly labeled, offline design preview. Choose Get Started, select interests and enter an adult date of birth. Browse people, like Ananya to see a simulated match, send local messages, search/filter plans, save plans, express preview interest, publish/delete local plans, edit your local profile, block/unblock preview profiles and reset preview data in Settings. All of those interactions persist on the current device. No messages or reports are sent to real people or moderators.

## Run the backend

Two explicit options are provided:

```powershell
# Temporary real MongoDB for local development; no Atlas credentials needed.
# First run downloads a MongoDB binary. Data disappears when stopped.
npm.cmd run api:local

# Or use your own durable MongoDB/Atlas:
Copy-Item apps/api/.env.example apps/api/.env
# Fill MONGODB_URI and JWT_SECRET, then:
npm.cmd --prefix apps/api run seed
npm.cmd run api
```

Generate your own secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and put it in **apps/api/.env only**. Never put a server secret into an `EXPO_PUBLIC_` variable. URI credentials must be URL-encoded. Restrict Atlas network access to the deployment/server IPs. The temporary local API binds only to localhost and seeds one fictional verified adult and one activity; it is never started by the production entry point.

Temporary local login: `preview@example.test` / `Along-local-only-2026`. These are public development fixture credentials, never production credentials.

`GET /health` reports process liveness. `GET /ready` reports database connectivity. Without MongoDB, the process starts but readiness and data routes return **503**. No live endpoint silently returns demo records.

To connect the app to the API, copy `apps/mobile/.env.example` to `apps/mobile/.env`, set `EXPO_PUBLIC_DEMO_MODE=false` and `EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1`, then restart Expo. On a physical phone use the computer's LAN IP and the durable backend command; set `CORS_ORIGINS` to any additional web origin. API mode enables login/register, plan reads, plan posting, interest, and bio updates. Live discovery and chat are deliberately unavailable until their server-side eligibility and consent work is complete.

Native credentials use Expo SecureStore. Web access tokens are memory-only. The refresh endpoint rotates tokens, but automatic client refresh/session restoration remains phase-two work. Unverified accounts cannot publish or express interest. Email delivery/verification is pending; the public API has no verification bypass. The explicitly local seed account lets developers check those routes.

## Current delivery

- Phase-one foundation: mobile project, navigation, tokens, reusable components, Mongo connection, API security middleware, validation, schemas/indexes, configuration, seed and documentation.
- Interactive reference UI: welcome, onboarding, discover, plans, create plan, activity detail, match, conversations, profile, settings, notifications and safety.
- Early backend modules: register/login, refresh/logout, categories, current user/profile, activity CRUD/interest, report intake and blocking. Public documents exclude credential hashes and exact birth dates.
- 28 backend tests, including the original foundation tests, admin/shared-database security tests and environment-based login tests. Browser smoke coverage includes the mobile preview and the authenticated admin operations documented in the admin setup guide.

**This is a mobile foundation and integrated operational admin, not a completed production dating service.** Remaining work: verified-email delivery/recovery, full account lifecycle and retention, complete onboarding/preferences/photos, Cloudinary uploads, permission-based location, ranking and mutual matching, Socket.IO authorization/history/read receipts, real notifications, advanced admin modules, full analytics, monitoring, deployment and physical-device QA. Payments and accommodation stay deferred. No compliance review has been completed. See [architecture and phased plan](docs/architecture.md) and [admin status](docs/admin-setup.md).

## Checks

```powershell
npm.cmd run typecheck
npm.cmd --prefix apps/mobile run lint
npm.cmd test
npm.cmd run build

# Serve the exported UI and run browser QA in two terminals:
npm.cmd run preview
npm.cmd run qa
```

Browser QA uses an installed Chrome at the Windows path in `tools/qa.mjs`. Change that executable path for another OS. Captured screens are in `docs/screenshots`. Android/iOS bundle export verifies JavaScript compilation; it does not substitute for opening the app in Expo Go or testing keyboard behavior on actual devices.

## Project map

```text
apps/mobile/src/app/          Expo Router routes
apps/mobile/src/components/   Reusable UI and brand components
apps/mobile/src/features/     Feature screens and reference fixtures
apps/mobile/src/services/     API transport and native token storage
apps/mobile/src/store/        Persisted preview interaction state
apps/mobile/src/theme/        Brand tokens
apps/api/src/                 Express, Mongo schemas, validation and tests
apps/admin/src/               Next.js admin UI and transport-only API proxy
packages/shared-types/        Public transport contracts
docs/                        Architecture, API and deployment notes
tools/                       Local static preview and browser smoke tests
```
