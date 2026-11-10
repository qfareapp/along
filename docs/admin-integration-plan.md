# Admin integration plan and inspection

The existing project has one Express app, one Mongoose connection, mobile JWT/refresh authentication, and User/Profile/Category/Activity/Interest/Match/Conversation/Message/Block/Report models. Matching and messaging are schemas and mobile previews, not running backend services. No prior admin roles, sessions, audit model or Socket.IO event server existed. This integration preserves those mobile routes and the preview mode.

The Next.js frontend uses the existing API through a transport-only proxy. It never imports Mongoose or database credentials. New administrative endpoints live under `/api/v1/admin`; operator accounts are existing User records with an adminRole, not duplicate mobile-user collections. Eight roles have server-enforced permissions. Admin session cookies cannot authenticate mobile JWT endpoints and mobile JWTs cannot authenticate admin routes.

Phase 1: Next.js/Tailwind/shadcn foundation, cookie sessions, mandatory TOTP/recovery codes, CSRF, permission checks, operator bootstrap, shared Mongo integration.

Phase 2: real database dashboard, paginated user management, verification, activity and category moderation, reports, audit. Enforcement mutations and audit writes use MongoDB transactions. Atlas supports this; local development/test uses a replica set.

Phase 3: versioned matching configuration and API/query refresh synchronization. Configuration is stored for the future matching engine; no fake ranking engine is introduced. Suspension is checked on every mobile request and increments token version, so reactivation never restores old credentials. Disabled categories hide existing activities until reenabled.

Later phases: support, CMS, geographically restricted launches, subscription administration, campaigns, full analytics, production Socket.IO delivery, admin invitations/role editing and independent security review. Missing data sources must be shown as untracked, never invented statistics.

Manual verification changes identityVerified, never emailVerified: identity review does not prove email ownership. Administrative account creation requires an operator action; mobile registration ignores privilege fields.
