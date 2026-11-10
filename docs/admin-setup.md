# Along admin: setup and status

The admin panel is a Next.js frontend for the **existing Along Express API and its single MongoDB connection**. It has no database client, separate business API or copy of mobile users. The small Next.js `/api/admin/*` proxy forwards requests and cookies to Express; all permissions and mutations are enforced there.

## Email and password login

Email/password login is available locally and in production. Configure these values in `apps/api/.env` locally, or in the Render API service's Environment settings:

```dotenv
ADMIN_AUTH_MODE=env
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=your-private-password
ADMIN_NAME=Along Admin
```

The real credentials are in the private file, not this example. Open that file to view or change `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 6 characters). These values stay in the backend environment; they are never sent to the frontend as configuration or committed to source control. No authenticator or recovery code is required in this mode.

Run `npm run api` from `D:\Along` in one CMD window, then `npm run admin` in another. Open **http://localhost:3000/login** and use the email/password from the backend file. No bootstrap command is required: the dedicated admin account is created on the first successful login if it does not already exist. An existing mobile user is never promoted automatically, and an existing suspended admin is never reactivated by configuration.

Changing credentials requires restarting the API and invalidates previously issued environment-login sessions. HTTP-only cookies, session expiry, CSRF, lockout, role checks and audit logs remain enabled. Recovery in this mode means changing the password in the backend file and restarting the API.

For production, keep `NODE_ENV=production`, `ADMIN_AUTH_MODE=env`, and set `ADMIN_ORIGIN` to the exact Vercel production origin. Keep the existing `MONGODB_URI` and `JWT_SECRET`. The first successful login creates the dedicated admin if needed; no bootstrap or authenticator code is required. Changing `ADMIN_PASSWORD` in Render and redeploying invalidates existing environment-login sessions. An existing MFA admin with the configured email can use the environment credentials after switching modes. Existing MFA sessions are invalidated. To opt into authenticator login again, set `ADMIN_AUTH_MODE=mfa` and use an MFA-provisioned account with its original encryption key.

## Optional temporary database with MFA

Dependencies are installed. On a fresh checkout first run `npm ci`, `npm --prefix apps/api ci`, `npm --prefix apps/mobile ci` and `npm --prefix apps/admin ci` from the repository root.

In the first CMD window:

```cmd
cd /d D:\Along
npm run api:local:admin
```

This starts an isolated temporary MongoDB **replica set**, seeds the existing fictional local mobile account/categories/plan, and asks you to create the initial Super Admin. Choose your own email, name and password. The password is hidden while typing. Use 6+ characters with uppercase, lowercase, a number and a symbol.

The terminal displays a private `otpauth://` setup URI and eight one-time recovery codes. Add the account to an authenticator app. For manual entry, the URI’s `secret` parameter is the setup key; use time-based codes, SHA-1, six digits and a 30-second period. Save the recovery codes securely. **Do not paste the URI or recovery codes into chat, screenshots or source files.** The API starts on port 4000 after setup.

In a second CMD window:

```cmd
cd /d D:\Along
npm run admin
```

Open **http://localhost:3000**. Sign in with the credentials you chose and your authenticator code. There is no default admin password. Always use the configured hostname: `localhost:3000` matches the default `ADMIN_ORIGIN`.

The local database and its encryption/session keys are temporary. All local data and the admin account disappear when that backend stops. Rerunning this local command creates a new temporary environment and requires new admin setup. Both clients within that environment still share one API/database. This command binds the API to loopback and is for desktop testing, not phone LAN access.

Stop the processes with Ctrl+C. If port 4000 or 3000 is already occupied by your previous Along process, stop that process first. Do not run a second API for the admin panel. If you change ports, update `ADMIN_ORIGIN` and the server-only frontend proxy target together.

## Use your durable MongoDB / Atlas database

1. Copy `apps/api/.env.example` to `apps/api/.env` and fill your existing `MONGODB_URI` and `JWT_SECRET`.
2. Generate a **separate** MFA encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `ADMIN_ENCRYPTION_KEY`. Keep this key stable, private and backed up; losing it makes stored TOTP secrets unreadable. Never use an `EXPO_PUBLIC_` or `NEXT_PUBLIC_` variable for a secret.
3. Set `ADMIN_ORIGIN=http://localhost:3000` for local development, or the exact HTTPS admin origin for deployment.
4. Run `npm run admin:bootstrap` once from the root in an interactive CMD terminal. This connects to your configured database and prompts for your credentials. It refuses to create another initial admin after its unique bootstrap claim is complete. It does not promote an existing mobile user or overwrite their password.
5. Run the existing `npm run api`, then `npm run admin` in another terminal.
6. If your API is not on the default address, copy `apps/admin/.env.example` to `apps/admin/.env.local` and set `ALONG_API_URL` to that same API origin, then restart Next.js. This variable stays server-side.

Atlas already supports the MongoDB transactions used for enforcement plus audit writes. A self-hosted MongoDB must run as a replica set; a standalone MongoDB is insufficient for admin mutations. The explicit local command configures a replica set automatically. Production and development must use separate databases, while mobile and admin within an environment share the same database.

## Connect the mobile application

The existing offline design preview is preserved. It is intentionally not controlled by the database. To see actual admin changes:

```dotenv
# apps/mobile/.env
EXPO_PUBLIC_DEMO_MODE=false
EXPO_PUBLIC_API_URL=http://localhost:4000/api/v1
```

Restart Expo. For web testing against the temporary local API, use the fictional member `preview@example.test` / `Along-local-only-2026` (never an admin login). For physical phones use the durable API’s LAN address, with both devices on the same Wi-Fi and the correct CORS configuration for web clients.

API mode fetches live categories and polls plans/account state every 15 seconds. Foregrounding the mobile app invalidates queries. A restricted or expired mobile session is cleared and the user is asked to sign in again. Restrictions are enforced on every backend request immediately; the UI polling interval does not authorize restricted operations. Identity verification appears on the live profile after refresh. Admin and mobile authentication credentials are deliberately separate.

## Implemented

- Next.js, React, TypeScript, Tailwind, shadcn-style Radix components, TanStack Query/Table, Recharts, React Hook Form and Zod.
- Reference brand colors, responsive sidebar, global user search, filters, pagination, profile detail dialogs, reason capture, confirmation, loading/error/empty states and toast feedback.
- Temporary local environment-based email/password login, or mandatory TOTP in MFA mode. OTP replay prevention, one-time recovery codes and password recovery remain available in MFA mode. Both modes retain login rate limiting and lockout, HTTP-only SameSite cookies, expiry/revocation, strict Origin validation and session CSRF tokens. Cookie Secure is mandatory in production.
- Eight persisted roles. Role checks happen on every request and every sensitive action. Role/invitation editing is not exposed yet.
- Actual database dashboard counts and aggregation charts. Missing billing/meeting sources display “not tracked.” The dashboard explicitly identifies metrics that remain platform-wide when city/category filters apply.
- User listing/search/status/identity/city filters, profile details, active plans, matching count, moderation history, suspend/reactivate/ban and posting/messaging restriction flags. Mutations revoke refresh sessions and increment mobile token version. Restoring a banned account requires ban permission.
- Manual verification review, activity moderation, category CRUD/disablement/order/city/type/risk/moderation fields, report investigation/resolution, append-only audit reading and restricted non-identifying CSV export.
- Versioned matching configuration with total-weight validation, stale-version protection and audited rollback by saving a prior configuration as a new version. This config is preparation for the still-unimplemented live recommendation service, not a claim that matching is operational.
- Shared public admin DTOs in `packages/shared-types/admin.d.ts`.

Category disablement policy: hide existing posts from mobile listing/detail/interest APIs, reject new posts, and leave stored posts intact for admin review. Reenabling restores eligible active posts. Categories requiring moderation create paused posts until approved. Accommodation remains disabled. Moderation decisions never create romantic consent.

Verification is identity/age review, not an email-ownership bypass. No raw identity documents or general conversation browser have been added. Provider onboarding and user verification-request UX are later work; the queue is empty until requests exist in the shared collection.

## Verified

28 backend tests pass, including the original regression tests plus MFA, OTP replay, CSRF, cookie flags, role denial, one-time bootstrap, account lockout, recovery-code replay, session revocation, user suspension/reauthorization, verification reflection, category disablement, removal, report review, matching versions and real dashboard counts. Environment-mode tests cover password-only login, six-character passwords, private cookies, credential-rotation invalidation, suspension, rejection of mobile-account promotion, logout and configuration privacy.

The production-built frontend was exercised in Chrome against an isolated real MongoDB replica set: login, live dashboard/users, suspension with mobile-token rejection, report resolution, category disablement reflected in mobile APIs, matching version, audit trail, HTTP-only cookie and responsive navigation. Screenshots in `docs/admin-screenshots` contain **fictional test records**, not production metrics or real user data. No production database was used.

```cmd
npm run typecheck
npm --prefix apps/admin run lint
npm --prefix apps/mobile run lint
npm test
npm run build
npm run qa:admin
```

The browser QA command requires a built admin app and local Chrome. Override `CHROME_PATH` if needed. It starts its own API on 4100 and Next on 3100 against one test database and stops them afterward. It never provisions an account in your configured database.

## Remaining phases and deployment

This delivers the integration foundation, dashboard/user management and core operational review/configuration tools. It is **not the entire six-phase production release**. Pending work includes admin invitations and editable roles, provider verification intake/expiry/appeals, support tickets, CMS publishing, location launch controls, campaign queues, notification delivery, full business/retention analytics, billing verification/refunds, production Socket.IO and the mobile matching/messaging services. The current UI does not include decorative links to those missing modules.

Production Socket.IO did not exist in the inspected repository and has not been fabricated. Synchronization here uses authoritative APIs, query invalidation and polling. There are no active conversation sockets to revoke yet; future messaging must check user status, token version, mutual consent and restriction flags on every operation. No private-message browsing endpoint exists.

Before deployment: finish required later modules, complete an independent security/privacy review, choose audit retention/backup policy, configure HTTPS, secure cookies, a fixed trusted origin, stable secrets, durable Atlas backups and monitoring. Audit API has no update/delete endpoints; database credentials and retention jobs must be separately controlled. Next.js must proxy the same trusted Express service over private networking/HTTPS. The proxy intentionally does not trust arbitrary forwarded client IP headers: current rate limits aggregate at the frontend proxy; configure a verified ingress/IP policy and shared rate-limit store before multi-instance deployment.

No public deployment, email delivery, billing enablement, external identity-provider verification or physical-device testing was performed.
