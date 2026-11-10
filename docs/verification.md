# Verification — 26 October 2026

The activity-first onboarding change adds 18 backend tests (46 total), a complete API-connected browser test, admin onboarding metrics and user eligibility checks. See [onboarding implementation record](onboarding.md) for the current checks and remaining physical-device/SMTP verification.

Temporary email bypass: 49 backend tests now pass, including three tests for optional email verification, preservation of all other eligibility checks and restoration of the email requirement. `EMAIL_VERIFICATION_REQUIRED=false` is currently set in the backend environment; SMTP code and actual emailVerified values are preserved. Run `npm run qa:onboarding -- --email-optional` to test this mode in the browser.

Passed:

- Cloudinary credentials verified with a real authenticated test upload, signed readback and immediate deletion. Uploads now use device JPEG normalization and multipart file transfer; see [photo upload setup](photo-uploads.md).

- Mobile TypeScript and Expo lint.
- API TypeScript and production compilation.
- Expo SDK dependency compatibility check.
- Android, iOS and Web bundle exports.
- 62 backend tests, including safe category initialization, profile discovery/swipes/privacy, Cloudinary/multipart uploads, optional email verification, onboarding persistence/eligibility, the original foundation suite, admin security/shared-database integration and environment-based login.
- API-connected onboarding browser QA: step selection, back/reload, optional skips, registration, isolated MongoDB persistence, restricted preview, simulated email verification, photo upload, discovery activation and failed-save retry. Screenshots are in docs/onboarding-screenshots.
- Admin production build and environment-login browser regression, including onboarding dashboard/user details.
- Browser tests at 390 × 844 and 1440 × 900: onboarding, discovery, preview match, local chat send, search, interest, plan publishing, reload persistence and profile. No page errors. Screenshots are in docs/screenshots.
- Temporary local API startup, readiness, fixture login and seeded activity read.
- Unconfigured API reports readiness 503 while liveness remains 200.

The configured backend currently reports readiness 200 with MongoDB connected; its URI selects the existing `along` database. Automated onboarding writes were tested against isolated MongoDB, not real member data.

Not verified: physical Expo Go startup, native keyboard/SecureStore/photo-picker behavior, real SMTP delivery, Cloudinary and production deployment. Bundle export does not substitute for physical-device testing. Brevo SMTP login/key and sender verification are still required for real email delivery; see email-setup.md.
