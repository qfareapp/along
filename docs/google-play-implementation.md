# Google Play in-app implementation and release handoff

Implemented 19 November 2026. Contact supplied by the operator: **thousandshare.1k@gmail.com** for support, privacy and child safety. Policies identify the app as Along; no legal company name or responsible person's name was invented.

## Implemented

- Shared, offline-readable in-app Privacy Policy, Terms & Community Guidelines, Child Safety Standards and deletion/retention information. Settings, signup and Safety Centre link to them. New signup explicitly requests agreement and records the version/date. Older clients' registration payloads remain accepted; their existing onboarding still requires terms/guidelines acceptance before discovery activation.
- Public HTML routes on the API server: `/privacy`, `/terms`, `/child-safety`, `/delete-account`. They do not require an app session. The deletion form requires email, password and an explicit permanent-deletion confirmation; rejects cross-origin submissions; uses bounded inputs and rate limits; supports restricted members who cannot enter the app. Credentials are never placed in URLs or reflected in the response. Contact-email assistance is also displayed. These routes need deployment before they are public.
- Safety Centre now sends a real block request. Settings lists real blocked members and supports unblocking. Blocking atomically ends regular matches and airport connections; unblocking does not revive those direct connections.
- General feedback/privacy/account/appeal and child-safety concerns can be submitted without selecting a member. In-app receipt includes a reference. Child-safety reports are marked critical and prioritised in the existing admin queue; no automatic external emails or law-enforcement reports are sent.
- Direct and group messages have report controls. Group members have safety controls. The server verifies conversation/group access, message ownership, group history boundaries and consistency with the reported target. Text evidence comes from the server, not client-supplied snapshots. Reports/evidence are not exposed to ordinary users.
- Participant blocks hide each other's group messages, previews, unread counts and roster entries. An organiser block closes access to that organiser's group. A visibility key invalidates previously loaded history when blocking, membership or moderated content changes, so cached pages cannot resurface hidden messages.
- Admin reports show categories, context and restricted text evidence. Authorised moderators can remove a reported direct/group message and queue its attachment for deletion through the existing CSRF/origin-protected, audited decision flow. Profile restrictions and Social moderation continue through their existing tools.
- Password-confirmed account deletion is transactional: removes personal credentials (email/birth date/password hash replaced by non-login tombstone fields), profile, owned messages/uploads, Moments/reactions/views/settings, Vibe Checks/attempts, game records, participation/settings, sessions/push records, verification/support records and related notifications. Organised plans become scrubbed tombstones and their groups close. Other members' own messages/accounts are preserved. Safety reports retain limited text evidence for up to 180 days from deletion; this deadline does not extend on cleanup retries.
- Provider/local media keys are queued in `MediaDeletion` in the same transaction before their source records disappear. A worker retries failures with leases/backoff. Provider deletion must acknowledge success or an already-missing object. Deleted accounts are swept for another day to remove in-flight writes. Pending jobs survive restarts and are not dropped after a fixed attempt count. Failed jobs log a generic retry message without exposing media keys. Cleanup failures roll back the initial deletion.
- Android blocks broad photo/video/audio reads, legacy storage, overlay, microphone and background-location permissions. Photo selection uses the system picker without broad-library prompts or editing that requires library access. Camera access remains an explicit feature request. Foreground location and notification permissions remain for their stated features.
- `production` EAS profile builds a store AAB. The preview APK profile remains available. Next Android version code: **7**.

## Retention and operator responsibilities

The implemented policy uses a 180-day maximum for general feedback and for reports associated with a deleted account. It does not retain raw reported media as a deletion exception; only limited report text/context remains. A deleted-member ID may remain to keep shared references consistent. Provider backups follow provider rotation rather than an invented guaranteed schedule. The operator must review this policy against actual provider contracts and applicable obligations before launch.

The app provides report intake and moderation tools; a human must monitor the queue and contact inbox, investigate, remove prohibited content, restrict accounts, handle appeals and make legally required reports to the proper authority. The policy does not claim automatic CSAM scanning or end-to-end encrypted chat.

Monitor `MediaDeletion` queue depth, age and attempts and application retry logs. Fix provider credentials/outages rather than deleting pending jobs. MongoDB must support transactions (Atlas/replica set), as required by other existing Along features. The worker runs while the API process is running and connected; a sleeping free hosting instance delays background work. Use an always-running worker/service for reliable production cleanup.

## Validation

Final result: **132 targeted test cases passed across suite runs**, all three app typechecks passed, mobile lint passed, API production build passed, Android/web exports passed, and browser checks passed at 390px and 820px. The consolidated run initially caught two test-fixture issues (standalone MongoDB lacked transaction support in chat tests; independent group tests shared a rate-limit store). After correcting the fixtures, all 10 chat and 21 group tests passed; production rate limits were not weakened. The other 101 cases passed in the consolidated run. Logs remain in ignored `.tmp/compliance-*-tests.log`/`.tmp/compliance-tests.log` files.

- Targeted automated suites cover deletion, rollback, retry/idempotency, late writes, report access, child-safety priority, moderation RBAC/CSRF/audit, real blocking, group history, airports, chat, push, onboarding and media storage. All tests use isolated in-memory MongoDB; no live users were deleted or notified.
- Root typechecks cover mobile/API/admin; mobile lint is required.
- Android and web exports verify the shared policy package resolves in release bundles.
- Expo introspection confirms all eight blocked permissions have generated `tools:node="remove"` directives. Inspect the final newly built APK/AAB merged manifest again before Play upload; build 6 still contains its original permissions.
- `tools/compliance-browser-qa.mjs` checks phone 390px and tablet 820px policy navigation, child-safety feedback, block/unblock, deletion disclosures and group message reporting using intercepted fictional requests. Serve `.tmp/compliance-web` on loopback port 18109 with `tools/preview.mjs` to run it. Screenshots are ignored by Git under `docs/compliance-screenshots`.
- Physical Android system-picker/camera denial, push delivery, 16 KB execution and Play pre-launch testing still need device/Console validation.

## Deployment and Console handoff

1. Review the operator/contact information and published retention text. Assign a responsible child-safety contact in Console and monitor the provided inbox/admin queue.
2. Deploy API and admin from this source, preserving the shared `packages/policies` directory as with existing shared modules. Check public URLs and the deletion form without an app login. Do not test deletion on a real user account.
3. After deployment the intended Play policy URLs are `https://along-5tiq.onrender.com/privacy`, `https://along-5tiq.onrender.com/child-safety` and `https://along-5tiq.onrender.com/delete-account`. They are intended URLs, not verified live pages from this implementation turn.
4. Build the next preview APK for device QA, then a production AAB with `npx.cmd --yes eas-cli@latest build --platform android --profile production`. Verify a version code higher than anything already uploaded to Play. No cloud build or store submission was started during this implementation.
5. Complete Data safety based on actual collection/processing/provider behavior, adult target audience/minor restrictions, IARC rating, ads declaration, reviewer access and any account-verification/closed-testing requirements. Precise GPS transmission needs assessment even though raw airport coordinates are not stored. HTTPS messaging is not end-to-end encryption.
6. Disable/isolate the Belgharia test location for public launch. The test airport was left unchanged during this task.

This implementation addresses the identified in-app gaps. Publication, operator procedures, Console declarations and Google's review remain necessary before claiming Play readiness.
