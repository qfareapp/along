# Owner plan status

Plan details show a themed, three-way owner control: **Pause**, **Go live**, **Plan success**. Selection is saved immediately and announced accessibly; controls are disabled during a request. The owner can reverse a selection. Going live again requires an eligible future, ongoing or recurring schedule.

Paused and successful plans disappear from public browse/search, saved-plan feeds and category live counts, and cannot receive new requests or accept pending interests. Existing matches, conversations, messages, participants and saved bookmarks are preserved. The organizer can still find these posts through **Your plans**, and category cards point to plans needing management. Successful plans have a success label in the owner listing.

`PATCH /api/v1/activities/:id/state` accepts `{ "state": "live" | "paused" | "successful" }`. Only the creator may change it; invalid states, deleted plans and outsiders are rejected. `ownerState` is separate from the existing administrative `status`. Missing `ownerState` on older records means live. Neither this endpoint nor a legacy owner status edit can override an administrative pause. Posting restrictions, required email verification, category availability and schedule eligibility are checked when going live.

The detail response includes `ownerState` and `publicationStatus`. Only the organizer can read a non-live plan. `owner=true` lists the organizer's non-deleted plans, including inactive and moderation-held posts. Category responses add `ownManagedCount` without changing the existing `ownPastCount` meaning. No data migration is required.

API tests cover ownership, all transitions, category counts, visibility, requests, moderation, expiry, restrictions and preserved chats. Browser QA verifies the real owner controls, navigation persistence, the Your plans listing, visitor visibility, chat access and narrow phone/tablet layouts. Preview mode uses the same controls and persists the selection locally. Physical-device touch and accessibility testing remains pending.
