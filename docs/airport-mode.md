# Along Airport Mode

Airport Mode is an opt-in Discover mode. It uses existing accounts and protected profile photos, existing chat messages/attachments, Along Play and Android push registrations. Airport connection requests are separate from dating swipes. A temporary connection never inserts a `Match` until both people choose **Stay connected**.

## User flow

1. Discover shows only a flight icon in its header, immediately left of Vibe Check. It stays neutral away from airports and uses a teal/coral colour with gentle motion near an enabled airport. Reduced-motion preferences disable animation. If foreground location permission already exists, nearby eligibility is checked periodically while the app is active and immediately on resume; this does not activate or publish the user.
2. Tap the flight icon to open the existing Airport Mode card as a floating panel; tap outside or press Back to dismiss. Tap the card to reach activation, detect an enabled airport, and select a configured broad zone, 30/60/90/120 minutes, intentions and explicit visibility consent.
3. See other eligible, opted-in visitors to the same airport. Dating respects reciprocal age/gender preferences; social conversation does not imply dating. Coffee additionally requires mutually configured zone compatibility and 30 minutes of remaining overlap.
4. Swipe left to pass or right to send an invitation for the selected shared intention. Only the recipient can accept. Accepted connections open the existing chat. Along Play can use the accepted connection while it remains authorized.
5. Manual exit, availability expiry or a confirmed departure returns Discover to normal. Temporary chat becomes read-only. Both participants choose Stay connected or End connection. One vote waits for the other; both votes promote to an ordinary match. Either end choice closes temporary access. Existing regular matches remain unchanged.

## Location limits

Only foreground location is used. A fresh fix (up to two minutes old, reported accuracy at most 150m) is required for activation. Precise user coordinates are processed for eligibility but never stored, returned to another member or put in a push payload. This is approximate proximity, not proof of terminal or immigration access; client location can be spoofed.

Configured airport polygons include a 500m perimeter allowance. Without a polygon, proximity uses an explicitly configured reference-point radius (default 1km), labelled approximate. A reference coordinate does not describe a large airport's entire footprint. Configure appropriate verified boundaries before claiming full-premises coverage.

While active, the app checks location every minute. Two outside readings at least one minute apart confirm departure. Presence expires after five minutes without renewal, even if the selected visit is longer. Consequently backgrounding/closing the app can end visibility; returning requires explicit check-in again. Departure while closed is handled on reopening, not by background GPS. Server reads independently enforce availability/presence expiry; the cleanup worker is not the authorization boundary.

## Supplied spreadsheet and import

The supplied `india airport.xlsx` was read as data using its Open XML cells; no macros, formulas or document instructions were executed. The 141 records are normalized into `apps/api/data/india-airports.json`, using persistent OurAirports numeric IDs and `[longitude, latitude]` coordinates. No terminal topology or boundaries were supplied.

From `apps/api`, first validate without writing:

```powershell
npm run airports:import
```

To import into the database configured by `MONGODB_URI`, an operator runs:

```powershell
npm run airports:import -- --apply
```

The importer is repeatable, validates records, skips invalid/duplicate source IDs, never deletes airports, and preserves enabled status, zones, radius, boundaries and configuration sources. New airports are disabled. Imports are never part of application startup or deployment. On 20 November 2026, the owner authorised importing all 141 supplied records into the configured database. All 141 were inserted and verified against the source coordinates with a 1km radius, initially disabled. Belgharia remains a separate enabled test location, giving 142 locations in total at import verification.

## Configure and launch

For location testing, Belgharia is available as a separate, explicitly labelled **Belgharia (Demo Airport)** seed at latitude `22.670388020903303`, longitude `88.3886244482948`, with a 1km radius and a synthetic demo test area. It has no invented IATA/ICAO code and is not part of the real airport spreadsheet import.

From `apps/api`, run `npm run airports:demo` to preview it, or `npm run airports:demo -- --apply` to add it to the configured database. A new demo record is enabled for testing. Re-running updates its identifying data/coordinates but preserves admin changes to its enabled status, radius and zones. Disable it through admin when testing is complete. It is never seeded automatically at startup.

1. Deploy the API and admin changes using the existing deployment settings. No new service, database, Firebase project or private key is required.
2. Run the explicit import against the intended database.
3. Open admin **Airport Mode** with `settings.manage` permission. Each airport has an **Enable / Disable** button and a detection-radius slider (100m–15km). Dragging previews the value; **Save radius** persists it and **Reset** discards the draft. Updates affect only the chosen setting on that airport and commit with an audit entry. Enabling an imported airport with no zones adds a single **Near airport (approximate)** area with no meeting compatibility, so discovery/chat can work without inventing terminal access. Existing zones, boundaries and review notes are preserved. Disabling ends active visits; re-enabling does not reactivate those visits.
   Optional **Advanced configuration** remains available for verified boundaries and broad zones. Zone IDs must be unique. Both zones must list one another to allow coffee invitations, including self-compatibility when appropriate. Empty compatibility lists allow remote conversation without a meeting recommendation. Do not invent zones, terminal connectivity or meeting spots.
4. Enable the airport only after reviewing its configuration. Admin changes require existing cookie authentication, origin/CSRF protections, permission checks and an audit reason; the update and audit record commit together.
5. Build/install an updated signed APK and test on two Android phones. Native location dependency/configuration already exists. Existing FCM setup and `PUSH_NOTIFICATIONS_ENABLED=true` control phone notifications. Existing Render Free sleeping behavior can delay workers and push delivery.

## Notifications, access and retention

Requests, acceptance, a Stay connected choice, and an End connection choice use the existing generic `Along` / `1 new notification from Along` phone push. Names and decisions appear only inside the authenticated app. Messages keep the existing message template without message text.

The first Stay connected vote creates an update for the other participant: “[Name] wants to stay connected.” Both can see the final outcome: **Both chose to stay connected!** uses a joining/heart/confetti animation and opens the continuing conversation; **Your airport connection has ended** uses a gentle parting animation and neutral wording. The person making the choice sees their result in-app; the other participant also receives the generic phone alert when push is enabled.

Decision updates are durable `AirportNotice` records with a unique event key and a 30-day TTL. The connection state, notices and push jobs commit in the same transaction. Retries do not duplicate updates, final outcomes supersede unshown keep prompts, and an authenticated per-recipient acknowledgement prevents a dismissed result from replaying on the next launch. Blocking, unmatching and account eligibility are checked before displaying notices. Updates remain in the existing notification centre and contribute to its unread badge. Foreground clients poll for updates; offline users see them when they return. Reduced-motion preferences disable the artwork animations.

Chat reads, writes, attachments and games recheck account eligibility, block/unmatch status and the temporary connection grant. New messages and games pause when either visit stops being live. The departure choice expires 24 hours after the recorded end; every request enforces the stored deadline. Airport sessions have a seven-day metadata TTL; terminal grant metadata is cleaned after 30 days. Existing chat storage/moderation retention remains in effect; ending a connection revokes access rather than promising message erasure. Account deletion ends airport grants and removes its session record.

No public traveller counts, gates, flight numbers, boarding passes, fabricated meeting spots, background location, future travel publication or automatic romantic matches are introduced.

## Verification

The per-airport row controls passed all 30 airport API regression tests, including authenticated/RBAC/CSRF protections, radius validation, enabling an imported airport without invented terminal zones, preserving existing settings, audit entries and immediate visit termination on disable. API/admin typechecks and targeted admin lint passed. `tools/airport-admin-browser-qa.mjs` uses intercepted fictional admin responses to check enable/disable, radius preview/save, retry after failure, independent rows and search at 390px and 1280px. These UI tests do not modify the configured database. API/admin deployment is required for the new controls to appear in the hosted panel.

`apps/api/src/airports.test.ts` uses an isolated in-memory MongoDB replica set. It covers import preservation, eligibility, expiry, privacy, zones, requests, concurrent acceptance/keep votes, chat history, game authorization, existing match preservation, scoped profiles and admin protection. The targeted regression run passed 77 tests across airports, account deletion, chat, discovery, Play and push. All three apps passed TypeScript checks; mobile lint and Android JavaScript export passed.

`tools/airport-browser-qa.mjs` exercises phone/tablet opt-in, setup, invitation, checkout and the departure choice with fictional airport fixtures on loopback only. It expects the existing isolated Play QA API at `127.0.0.1:4118` and a mobile Expo Web preview at `localhost:18100` configured for that API with demo mode off. Screenshots are written under `docs/airport-screenshots` (ignored by Git). Physical departure/GPS behavior and push receipt still require device testing.

The decision-notification update passed 43 targeted airport/push tests, including first-vote recipients, duplicate suppression, final notices for both users, ended-chat denial, acknowledgement ownership and blocked-user filtering. `tools/airport-decision-browser-qa.mjs` verifies the incoming choice prompt, mutual celebration, own/received ending feedback and acknowledged/offline notices on phone/tablet layouts. Mobile lint and all app TypeScript checks passed.
