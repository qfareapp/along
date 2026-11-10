# Deployment and remaining verification

The source targets Node 22.13+ and an Atlas/local MongoDB replica set for future transactional matching. Deploy API over HTTPS with production `NODE_ENV`, a strong independent `JWT_SECRET`, `MONGODB_URI`, exact permitted `CORS_ORIGINS` and platform-assigned `PORT`. Build with `npm ci` then `npm run build` from `apps/api`; start with `npm start`. Configure load-balancer readiness to `/ready` and liveness to `/health`. Explicitly configure Express proxy trust to match the actual ingress topology before running behind a proxy so IP rate limiting works correctly. Never broadly trust arbitrary proxies.

Local temporary MongoDB is a dev dependency and must not be used for deployment. A production install may omit dev dependencies after compiling. Do not run `dev:local` in production. No site/app-store deployment has been performed.

Use Expo EAS for eventual signed mobile builds after the remaining service work and physical-device testing. Set only the public HTTPS API URL in the mobile environment. Expo Go is the current development target. Remote push requires a development build and Expo/APNs/FCM credentials; the current notification UI is only an in-app preview baseline.

Before launch: complete the pending modules listed in README; run an independent privacy/security review; validate consent and retention workflows; provision moderation; add per-resource abuse controls; test slow/offline networks, accessibility/font scaling, native keyboards and safe areas on iOS/Android. Seed only fictional adults.

Initial npm audit surfaced upstream Expo tooling dependencies on node-forge and Zod 3. SDK-compatible version constraints must be preserved when applying updates. Do not use an unreviewed forced major upgrade. The backend installation audit reported no vulnerabilities at implementation time. Re-run audits before deployment.
