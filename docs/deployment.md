# Deployment and remaining verification

## Vercel admin with Render API

Import `qfareapp/along` at [Vercel New Project](https://vercel.com/new), select branch `main`, and set **Root Directory** to `apps/admin`. Select **Next.js** as the framework and Node.js **22.x**. Enable **Include source files outside of the Root Directory in the Build Step** under the root-directory settings: the admin imports `packages/shared-types` and its Turbopack root is the repository root.

The admin's `vercel.json` sets the install command to `npm ci --include=dev` and the build command to `npm run build`. Keep the output directory at its Next.js default. Vercel manages serving the application; no start command is required.

Add `ALONG_API_URL` to the Vercel project's **Production** environment, using the Render API's public HTTPS origin, for example `https://your-api.onrender.com` (replace with the actual URL; no `/api/v1` suffix or trailing slash). The admin proxy adds the API path itself. Keep this variable server-side. API database, JWT, MFA encryption and Cloudinary credentials remain on Render. Leave Vercel's `NODE_ENV` at its production default.

Deploy, then copy the stable production Vercel domain (or your custom admin domain). On the Render **API** service, set `ADMIN_ORIGIN` to this exact HTTPS origin, for example `https://your-admin.vercel.app`, with no path or trailing slash, and redeploy the API. The API validates this origin for login and authenticated writes. Its existing CORS setup already includes `ADMIN_ORIGIN`. Changing to Vercel means this origin replaces the former Render admin origin.

Open `/login` on the stable production domain and sign in with the existing provisioned MFA admin. Preview deployment domains differ from the production origin and will not pass the API's origin check; use a separate staging API if authenticated previews are needed. If the API is on Render's Free plan, its first request after sleeping may exceed the admin proxy's 15-second timeout; wait for `/ready` to respond and retry login.

References: [Vercel monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq), [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Vercel environment variables](https://vercel.com/docs/environment-variables).

## Render API and admin dashboard

The root `render.yaml` defines `along-api` and `along-admin` on Render's Free plan in Singapore, tracking GitHub branch `main`. Both use Node 22. The native mobile app continues to run in Expo or a mobile build; this Blueprint does not publish a browser app.

[Deploy the Along Blueprint](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fqfareapp%2Falong), sign in, and grant Render's GitHub integration access to `qfareapp/along`. Alternatively choose **New → Blueprint** in Render and select that repository. Review the two services and supply the prompted environment values. No deployment has occurred merely by adding the file to GitHub.

Keep **Root Directory blank** for both services. The API imports `packages/plan-details` outside `apps/api`, so restricting the root to an app folder breaks the build. Build filters limit automatic deploys to each app and its shared packages.

| Service | Build command | Start command | Health check |
| --- | --- | --- | --- |
| API | `npm --prefix apps/api ci --include=dev && npm --prefix apps/api run build` | `npm --prefix apps/api start` | `/ready` |
| Admin | `npm --prefix apps/admin ci --include=dev && npm --prefix apps/admin run build` | `npm --prefix apps/admin start` | `/login` |

Configure these secrets on the **API service**, not in GitHub or the mobile app:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Durable MongoDB Atlas connection string, including the existing Along database name. Permit the API service's listed outbound IP ranges in Atlas Network Access. |
| `ADMIN_ENCRYPTION_KEY` | The existing stable 64-character hexadecimal key used to encrypt your admin MFA secrets. Preserve it when reusing an existing database. For a fresh database, generate it privately with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. |
| `ADMIN_ORIGIN` | The admin service's actual public HTTPS origin, with no path. Render can assign a suffix when a service name is already taken; update this value if the final URL differs. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | The existing Cloudinary account credentials for private profile, Moment and chat media. |

Render generates `JWT_SECRET`. `ALONG_API_URL` on the admin service references the API service's generated HTTPS URL. `ADMIN_ORIGIN` is entered manually to avoid a circular service reference. The API already permits this admin origin in CORS. Add any additional browser origin to `CORS_ORIGINS` if needed. Native mobile requests do not need a browser origin.

The Blueprint keeps email OTP verification disabled (`EMAIL_VERIFICATION_REQUIRED=false`), as requested. It sets production admin authentication to MFA; temporary local environment-password login is rejected in production by the existing API. Use an already provisioned MFA administrator, or follow [admin bootstrap](admin-setup.md) against the deployment database with the same encryption key. Do not run local fixture seeding against live member data.

After deployment, verify the API's `/health` and `/ready`, then open the admin URL and sign in. Point the mobile build's `EXPO_PUBLIC_API_URL` to `<actual-api-url>/api/v1` and keep `EXPO_PUBLIC_DEMO_MODE=false`; restart Expo or rebuild the mobile app to apply the URL. Free services can sleep while idle, so an initial request may wait for a cold start. Member uploads use authenticated Cloudinary because Render's local filesystem is ephemeral.

If the admin build reports `<head>` key warnings followed by a `useContext` error while prerendering `/_global-error`, check the Render service's `NODE_ENV`: it must be exactly `production`. The admin build/start scripts explicitly enforce this before loading Next.js and its workers. The same failure was reproduced with an inherited `NODE_ENV=development`. Keep the app-specific build command above, then use Render's **Clear build cache & deploy** after correcting an earlier deployment. Do not change React versions or disable prerendering merely to hide this environment mismatch.

References: [Render Blueprint fields](https://render.com/docs/blueprint-spec), [monorepo roots](https://render.com/docs/monorepo-support), [deploy button](https://render.com/docs/deploy-to-render), [free service limits](https://render.com/docs/free).

## Deployment notes

The source targets Node 22.13+ and an Atlas/local MongoDB replica set for future transactional matching. Deploy API over HTTPS with production `NODE_ENV`, a strong independent `JWT_SECRET`, `MONGODB_URI`, exact permitted `CORS_ORIGINS` and platform-assigned `PORT`. Build with `npm ci` then `npm run build` from `apps/api`; start with `npm start`. Configure load-balancer readiness to `/ready` and liveness to `/health`. Explicitly configure Express proxy trust to match the actual ingress topology before running behind a proxy so IP rate limiting works correctly. Never broadly trust arbitrary proxies.

Local temporary MongoDB is a dev dependency and must not be used for deployment. A production install may omit dev dependencies after compiling. Do not run `dev:local` in production. No site/app-store deployment has been performed.

Use Expo EAS for eventual signed mobile builds after the remaining service work and physical-device testing. Set only the public HTTPS API URL in the mobile environment. Expo Go is the current development target. Remote push requires a development build and Expo/APNs/FCM credentials; the current notification UI is only an in-app preview baseline.

Before launch: complete the pending modules listed in README; run an independent privacy/security review; validate consent and retention workflows; provision moderation; add per-resource abuse controls; test slow/offline networks, accessibility/font scaling, native keyboards and safe areas on iOS/Android. Seed only fictional adults.

Initial npm audit surfaced upstream Expo tooling dependencies on node-forge and Zod 3. SDK-compatible version constraints must be preserved when applying updates. Do not use an unreviewed forced major upgrade. The backend installation audit reported no vulnerabilities at implementation time. Re-run audits before deployment.
