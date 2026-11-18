# Android phone notifications

Along uses Expo Push Service with the existing project's Firebase FCM V1 credentials. The private Firebase service-account key belongs in Expo Credentials, never in this repository or the Render environment. `apps/mobile/google-services.json` is the Android client configuration; its registered package must be `com.qfareapp.along`.

## Notification formats

| Event                                                                                 | Title                   | Body                          | Tap destination     |
| ------------------------------------------------------------------------------------- | ----------------------- | ----------------------------- | ------------------- |
| Direct messages, attachments and Social private replies/shares                        | New message from [name] | Open Along to read it.        | That conversation   |
| Plan group messages                                                                   | New message from [name] | Open Along to read it.        | That group          |
| Likes, mutual matches, plan requests/decisions, Social updates and Vibe Check results | Along                   | 1 new notification from Along | Notification centre |

Push payloads omit message text, attachments, like identities, plan details and Vibe Check answers. The app's authenticated screens load details after opening. In the foreground, notifications for the currently open chat are suppressed. A tap for a different signed-in account is ignored; cold-start taps wait for account and navigation readiness. Web and Expo Go do not register devices. This implementation enables Android; iOS push credentials and delivery are not configured.

## Activate after Firebase setup

1. Upload the Firebase service-account private JSON to the existing Expo project `@qfareindia/along`, Android package `com.qfareapp.along`, under FCM V1 service account key. Keep the existing Android signing credentials.
2. Put the downloaded **client configuration** at `apps/mobile/google-services.json`. `app.json` points to this file and includes the `expo-notifications` plugin. The SDK-compatible dependency is installed.
3. Deploy this API version to Render. On the **API service**, set `PUSH_NOTIFICATIONS_ENABLED=true`, then save and deploy. It defaults to false so deployment/testing cannot accidentally send notifications. If Expo enhanced push security is enabled, also set `EXPO_ACCESS_TOKEN` to a server-side Expo access token. Never put this token in an `EXPO_PUBLIC_` variable.
4. Build and install a new signed preview APK from `apps/mobile`: `npx eas-cli@latest build --platform android --profile preview`. An older installed APK cannot register for push. Increment Android `versionCode` for the new release.
5. Sign in and allow notifications. Android Settings and Along **Settings > Phone notification settings** control permission, sound and the Messages/Along notifications channels. Denying permission does not prevent using Along. Registration retries on app resume and periodically while active.
6. Test on two Android phones with Google Play services: send a direct message, photo/file, group message, like and plan request/acceptance while the recipient app is backgrounded. Test tapping alerts with the app backgrounded and after normal termination, and confirm already-open/read chats do not create duplicate banners. Also test denial/re-enabling, logout/account switching, blocking and group removal.

The API needs an always-running process for prompt queue processing. The repository's Render Free plan can sleep, delaying delivery and retries. Provider acceptance is not a guarantee of display: OS settings and device connectivity still apply. Expo receipts confirm handoff to the device push provider, not that the user saw an alert.

## Lifecycle and delivery

`PUT /api/v1/push-devices` registers `{ installationId, token, platform: "android" }` under the authenticated account. The server derives ownership and session version; clients cannot choose a recipient. `DELETE /api/v1/push-devices/:installationId` removes only that account's installation. Logging out unregisters with a short timeout and clears delivered notifications. When offline, unregister is best effort; a subsequent account registration reassigns the installation, and revoked sessions/deleted or suspended users are excluded from future sends. Registrations expire after 30 days without renewal. Account deletion removes registrations immediately.

Events enqueue one MongoDB job per registered installation with a unique event/device key. Transactional acceptances, Vibe Check results and group messages enqueue in the business transaction, so rollbacks produce no push. The API's background worker claims jobs with an atomic lease every three seconds; notification provider requests are outside user-facing write transactions. Temporary failures retry with backoff. Accepted tickets are checked after 15 minutes; no second send occurs while awaiting a receipt. Invalid device tokens are removed only if the token still matches, protecting replacements. Jobs expire after seven days; failures are bounded and record only provider error codes. No message bodies or credential values are logged.

Delivery rechecks active account/session ownership and blocks. Direct messages also recheck conversation access and unread state; group messages recheck current membership and read sequence. Delivery is at least once: the provider might accept a send before a connection fails, so retries can occasionally duplicate an alert. Notification failure does not roll back an already committed message. If a nontransactional business write commits but its queue insertion fails, that alert can be missed; there is no historical backfill or reconciliation worker in this version.

## Verification

`push.test.ts` uses a temporary MongoDB replica set and a mocked Expo transport. It covers authentication/token validation, installation ownership, account changes, exact templates, chat and request hooks, unread/blocked/revoked access, group removal, duplicate prevention, concurrent workers, retry/receipt handling and transaction rollback. It sends no actual pushes and accesses no production data. Real-phone receipt/tap testing remains necessary after deployment and installing the new APK.

References: [Expo SDK 58 notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/), [FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/), [sending and checking receipts](https://docs.expo.dev/push-notifications/sending-notifications/).
