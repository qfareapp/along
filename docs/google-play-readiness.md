# Google Play readiness audit

## Implementation update — 19 November 2026

The findings below describe APK build 6 and its original source. A subsequent implementation now addresses the in-app gaps in source: shared Privacy/Terms/Child Safety/deletion pages, explicit signup agreement, server-backed blocking and unblock management, general/child-safety feedback, direct/group message reports with authorised evidence, moderation removal, complete account-content cleanup and durable provider retries, and restricted Android permissions. A production AAB profile is prepared and the next Android version code is 7.

Support/privacy/child-safety contact: **thousandshare.1k@gmail.com**, supplied by the operator. A named person must monitor this address and the admin safety queue; displaying an email does not establish an operational safety process.

These changes are local source changes, not a newly released APK or deployed policy site. See [implementation and release handoff](google-play-implementation.md) for verification, public routes and remaining release work. Do not use the original findings below as a statement that the source fixes are absent, or treat source fixes as Google approval.

Reviewed 19 November 2026 against Google's published requirements. Scope: repository at commit `5d1d810`, the signed Along 1.0.0 versionCode 6 APK, and static inspection of mobile/API/admin flows. This is a readiness assessment, not a Google approval or a complete legal/security certification. Play Console declarations, developer-account status, third-party contracts and physical-device behavior were not accessible. No app code, production data or Console settings were changed.

**Verdict: not ready for Play submission.** The main remaining work concerns policies, deletion, moderation and permissions rather than the target SDK.

## Confirmed blockers and high-risk findings

### 1. Privacy policy is absent from the reviewed app

`apps/mobile/src/app/policies.tsx` contains Terms & Community Guidelines only. Settings and registration do not offer a dedicated Privacy Policy. No public policy URL or privacy contact was found in the reviewed source. A separate policy hosted elsewhere cannot be ruled out, but it is not integrated here.

Publish a public, accessible HTML privacy policy identifying Along/the developer and a real contact. Link it in the app and Play Console. Describe profile information, date of birth, dating preferences, photos, messages, chat attachments, Moments, approximate location, precise airport-location processing, airport presence, push tokens, security logs, service providers, retention and deletion. Describe actual provider practices rather than assuming all providers qualify for a Data safety sharing exemption.

Source: [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en).

### 2. Account deletion is incomplete

The in-app path exists at Settings > Delete profile, with password confirmation and session revocation. However, `apps/api/src/app.ts:227` sets the account to deleted and clears profile fields while retaining the user email, birth date and password hash. The handler does not comprehensively delete/anonymize messages, chat uploads, Moments, group content and other account-linked records. Profile photo deletion errors are swallowed before local photo records are removed, leaving no demonstrated durable retry path for provider deletion.

The screen discloses a minimal safety record and permanent email reservation, but that does not establish a justified retention basis or schedule for every retained data type. Google permits legitimate security/fraud/legal retention if properly explained; retaining the whole account indefinitely requires further justification and minimization.

Implement an inventory of associated records and provider objects, deletion/anonymization rules, limited documented retention exceptions, durable provider cleanup retries and verification. Add an external deletion-request web resource that works without reinstalling the app. No such public resource was found in the repository; the API endpoint requires an app session.

Source: [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

### 3. Social/dating child-safety standards are missing

There is no explicit published CSAE/CSAM policy, public standards URL or designated child-safety contact in the reviewed materials. The general prohibition on sexual exploitation is insufficient evidence of the full required process. These requirements apply to adult-only social/dating apps too.

Publish Along-specific child-safety standards; define how reports are triaged, prohibited content is removed, evidence is handled and legally required reporting is performed. Assign a real responsible contact and complete the corresponding Console declaration. Existing reports/admin review provide part of the infrastructure, not proof of operational compliance.

Source: [Child Safety Standards](https://support.google.com/googleplay/android-developer/answer/14747720?hl=en).

### 4. Broad photo access is unnecessary for the current picker flow

The actual merged APK manifest includes `READ_MEDIA_IMAGES` with maxSdkVersion 33, plus legacy storage permissions through API 32. `apps/mobile/src/components/onboarding.tsx:338` asks for media-library permission before opening the image picker. Profile/chat/Moment photo selection should use selected-file access wherever sufficient. A permission limited to Android 13 still needs justification on that supported platform.

Remove unnecessary broad access and permission prompts; verify the merged production manifest and denial behavior on Android 13 and newer. Review legacy storage needs separately. `SYSTEM_ALERT_WINDOW` is also present although no overlay feature was found; remove it unless a real release feature requires it. Camera, notifications and foreground precise location have identifiable app purposes. No background-location, microphone, contacts or SMS permission was found in this APK.

Source: [Restricted permissions and minimum-scope alternatives](https://support.google.com/googleplay/android-developer/answer/16935362?rd=1).

### 5. Safety Centre's block action is still a preview operation

`apps/mobile/src/features/Settings.tsx:173` renders the live Safety Centre. Its report action posts to the API, but its Block Preview Profile action only updates local Zustand state. The live chat options navigate to this screen. That button does not invoke `/blocks` and cannot establish a server-enforced block. Other profile screens do invoke the real API, so the defect is specific to this exposed safety path.

Wire the live safety action to server blocking and verify discovery, direct chat, airport connections and group behavior after blocking. Group members are currently rendered as plain names in `PlanGroupChat.tsx`, with organiser removal but no direct report/member-profile route. Add accessible member/content reporting and appropriate blocking protection; organiser removal alone does not satisfy all participant safety needs. Provide enough message/content context for moderators and verify actual enforcement. The generic Safety Centre opened without a target offers tips but no general feedback form or support contact.

Source: [User Generated Content policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en).

### 6. The existing build is an APK for internal distribution

`apps/mobile/eas.json` has only the preview/internal APK profile. New Play apps must be published using an Android App Bundle. Add a store production AAB profile, preserve package identity/signing continuity and use an unused version code when appropriate. Building an AAB does not resolve the policy findings above.

Source: [Android App Bundles](https://developer.android.com/guide/app-bundle).

## Technical checks that passed

- Actual signed APK: `com.qfareapp.along`, version 1.0.0, versionCode 6, minimum API 24, target API 36. Target API 36 satisfies the currently published new-app/update requirement.
- APK includes arm64-v8a and x86_64, plus 32-bit variants. No debuggable application flag was reported by `aapt dump badging`.
- Android SDK 36 `zipalign -c -P 16 4` passed. All 52 bundled 64-bit ELF libraries passed static 16 KB load-segment alignment/congruence checks. This is not a substitute for execution on a 16 KB device/emulator or validation of the eventual AAB.
- Signup rejects under-18 birth dates on the server (`apps/api/src/validation.ts:46`). Onboarding records terms/guidelines consent. Runtime location/camera/notification requests exist.
- API block/report endpoints, profile safety controls, Moment reporting and admin report review exist. Their existence does not prove complete moderation coverage.
- Airport GPS access is foreground-only. Precise readings are transmitted to the API for airport checks; airport-session documents store presence/airport/zone rather than raw user GPS coordinates. Ephemeral transmission still needs assessment in Data safety disclosures.
- All three application typechecks and mobile lint passed during this review.

Sources: [Target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en), [16 KB guidance](https://developer.android.com/guide/practices/page-sizes).

## Play Console and operational items not verified

- Developer identity/account verification and package ownership/signing registration.
- Accurate Data safety answers covering all collected data and SDK/provider behavior. No completed form was available. Do not claim end-to-end encrypted messaging: HTTPS transport is different from end-to-end encryption.
- Adults-only target audience, accurate IARC content rating and the applicable Console tools to restrict minors for dating/matchmaking. In-app age gating alone does not prove Console compliance.
- Child-safety declaration/contact and public policy/deletion URLs entered in their required fields.
- Store listing, real screenshots, support email, ads declaration and app-access instructions. Supply a working reviewer account and access to gated discovery/airport flows without asking reviewers to spoof GPS or bypass security. Explain any geography restrictions.
- If the developer account is a personal account created after 13 November 2023, the required closed test normally needs at least 12 testers continuously opted in for 14 days, followed by an application for production access.
- Real-device signup, email verification/recovery, notifications, camera/photo denial, deletion, low connectivity and crash/ANR checks; Play pre-launch report; 16 KB runtime testing.
- No active payment/ads SDK flow was identified in the reviewed app. Reassess billing/ads obligations if monetization is introduced.
- Disable the Belgharia test airport before a public launch, or isolate test fixtures from production. This is a release-quality recommendation, not a standalone Google policy prohibition. Do not change production data as part of this audit.

Sources: [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en), [Age-restricted functionality](https://support.google.com/googleplay/android-developer/answer/16302250?hl=en), [App content/review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en), [New personal-account testing](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en).

## Recommended order

1. Establish real developer/support/child-safety contacts and retention decisions.
2. Fix server-backed safety controls, complete deletion and remove unnecessary permissions.
3. Publish and integrate privacy, child-safety and deletion pages.
4. Complete the Console declarations, rating, age restrictions and reviewer access.
5. Build a production AAB and validate it on Play internal testing, then complete any required closed testing before production submission.
