# Tablet and resizable-window support

Along now uses the available application window instead of a fixed 460-pixel phone frame. The same screens adapt to tablets, landscape orientation, desktop browsers and narrow split-screen windows.

## Layout behavior

- The application fills the viewport, with an upper width limit of 1440 logical pixels for large desktop windows.
- At window widths of 768 pixels and above, the five existing navigation tabs become a left sidebar. Narrower windows retain bottom navigation. Navigation state survives resizing.
- Category grids adapt from one column on very narrow screens to two, three or four columns. Plan listings use two columns when their available content width can accommodate readable cards.
- Forms and public profiles are centered within 680 pixels. General reading screens use up to 840 pixels; plan browsing uses up to 1200 pixels. These limits avoid stretching text and fields across an entire tablet.
- Conversations use up to 1000 pixels; message bubbles remain capped at 560 pixels. Draft messages survive rotation.
- Discover cards and public-profile photos adapt to available height. Photo paging measures its rendered width and keeps the selected page aligned after resizing.
- Welcome content scrolls when the window is too short, keeping entry actions reachable in landscape.
- The existing keyboard-reveal and safe-area handling is retained. Bottom navigation now accounts for the home-indicator inset. Shared layout calculations also consider system font scaling when deciding grid density.

## Native configuration

`apps/mobile/app.json` uses `orientation: "default"`, keeps `ios.supportsTablet: true`, and explicitly allows iPad multitasking with `ios.requireFullScreen: false`.

Installed standalone builds need a new native build to pick up orientation and iPad configuration changes. Reload the development app to pick up the JavaScript layout changes. No new application dependencies or native modules were added.

## Files

The shared responsive metrics live in `apps/mobile/src/components/layout.tsx`. The application shell, tab navigator and shared `Screen` component consume those widths. Plans, category cards, Discover, public profiles, conversations, welcome, authentication, posting, onboarding, profile unlock and profile editing use appropriate responsive layouts.

`npm run qa:tablet` exports the web app and runs the existing isolated-MongoDB browser flow with additional tablet checks. The browser harness lives in `apps/api/src/plans-browser-qa.ts`; `tools/plans-qa.mjs` forwards its flags. Screenshots are saved under `docs/tablet-screenshots/`.

## Verification

- Browser layouts checked at 320×740, 390×844, 500×900, 768×1024, 800×1280, 1024×768, 1280×800 and 1440×900.
- Checked full application width, sidebar/bottom navigation switching, expected category column counts, and absence of horizontal document overflow at each size.
- Verified welcome actions in a short landscape window and onboarding selections across resizing.
- Verified Discover, category browsing, public profiles and photo sizing, filters, saved plans, full activity details, organizer acceptance, messaging and replies.
- Verified posting and chat drafts survive portrait/landscape changes; the posting draft also survives a narrow split-screen window. Published a group plan in the isolated test database and checked the profile editing form.
- Retained coverage for owner-only earlier plans, rescheduling and refreshed live counts.
- Successfully exported Android and iOS Hermes bundles and the web bundle with Expo SDK 58.
- Ran mobile and API TypeScript checks and mobile ESLint with its cache disabled.

All browser test data is created in disposable MongoDB instances. This work does not modify production activity records.

## Physical-device checks still required

Browser viewport testing and native bundle exports do not replace hardware testing. A physical iPad and Android tablet were not available. Verify native software/floating keyboards, hardware-keyboard focus, safe areas/home indicators, OS-level split view, rotation and accessibility text sizing on devices before a release.
