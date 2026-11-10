# Discover profiles and browse plans

In live mode, **Discover** shows one individual member profile at a time. Swipe right or tap the heart to like, swipe left or tap the cross to pass, and tap the star to save a profile. Tapping the card opens that member's profile. Likes and saved profiles are available through the heart in the header. A reciprocal like displays a mutual-like notice; this change does not create a fabricated conversation or an activity-based match.

**Plans** displays activity posts through the existing activity API, with category/search/saved-plan controls. Profile swipes and saved profiles do not create or save activity posts. Neither tab redirects eligible members to the onboarding inspiration screen.

Both tabs retain mandatory profile-unlock checks. Incomplete profiles see a compact completion prompt. Discovery only includes other currently eligible, active, unblocked members whose age and gender preferences match mutually. The default filter is the member's city, with an All Cities option. Shared selected vibes prioritize the returned batch. The app displays city labels rather than inventing distance from coordinates it does not collect.

If no other eligible members match, the app shows an empty state and a refresh/all-cities control. It does not insert demo members into the configured database. Explicit demo mode retains the original fictional profile preview.

## Backend

The existing Express API exposes:

- `GET /api/v1/discovery?cityOnly=true|false`
- `GET /api/v1/discovery/likes`
- `GET /api/v1/discovery/:id`
- `POST /api/v1/discovery/:id/action` with `{ "action": "like" | "pass" | "save" }`

Swipe actions are stored in a dedicated ProfileSwipe collection in the same existing database, with a unique user/target index. Retries update the same action. Prior choices stay out of the feed after app restarts. Eligibility, blocks and mutual preference rules are checked on detail reads and actions as well as feed reads. Display DTOs contain name, age, occupation, city, biography, explicitly selected vibes, optional personality answer and owner-validated photo IDs. Email, full DOB, exact location and private preference fields are not returned.

Photos continue to use the protected photo endpoint. Web image blobs are fetched with authorization and revoked on unmount; native images use authenticated request headers. No Cloudinary credentials or signed delivery URLs are passed to the client.

Implementation: `apps/api/src/discovery.ts`, `apps/mobile/src/features/LiveDiscover.tsx`, `apps/mobile/src/services/discovery.ts`, existing Discover/Profile/Plans routes and shared models.

## Plan categories

The API initializes the standard 12 categories when the existing category collection is empty. Initialization skips catalogs that already contain records, including intentionally disabled catalogs. Manual seeding adds missing records without overwriting names, enabled state, city restrictions or allowed post types.

Create a Plan shows loading/retry/empty states, requires an available selected category, highlights the selection and preserves it when navigating backward. Only categories allowed for the chosen plan type are selectable. The selected category is shown again before publishing. Browser QA verifies changing the category, going back and publishing the chosen slug.

## Validation

Six discovery integration tests cover mutual eligibility/privacy, incomplete access denial, profile details, saved choices/retries, real reciprocal likes, and removal after blocks/suspension/eligibility loss. All 60 API tests pass. The existing browser QA also checks profile cards, gesture passing, liking, saving, profile details and the separate Plans tab using fictional accounts in an isolated test database.

Physical-device gesture behavior still requires confirmation in Expo Go. No physical device is connected to this workspace.
