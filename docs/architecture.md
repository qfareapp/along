# Along architecture

The visual reference defines the design; the pasted brief defines the product. Native iOS/Android is the target, with Expo Web preview from the same code.

## Decisions

Expo SDK 58, React Native 0.88, React 19.3, TypeScript and Expo Router. Versions checked against Expo's SDK and Expo Go documentation on 25 October 2026. StyleSheet design tokens avoid an additional CSS runtime. Zustand manages local state; TanStack Query manages API state. Native tokens use SecureStore, never AsyncStorage. Demo data is explicitly fictional and separate from live data.

Express 5, Mongoose, Zod, JWT and bcrypt form the backend foundation. Atlas, SMTP, Cloudinary and production deployment require operator credentials. No invented credentials or silent demo fallbacks. Accommodation is disabled per the MVP brief despite appearing in the visual. Payments and precise routing are future modules.

## Modules and data

Mobile routes live in `apps/mobile/src/app`, with screens, components, stores and services outside the router. Backend separates application setup, config, validation, models and services. Shared transport contracts live in packages.

User stores private credentials and status. Profile stores public presentation and mutual preferences. Category is dynamic. ActivityPost stores coarse zone, schedule, post type and status. ActivityInterest has a unique (post,user) index. Match uses canonical participant pairs. Conversation belongs to a match. Message has a compound conversation/time cursor index. Block uses a unique directed pair. Reports and audit records are moderator-only. Refresh sessions store hashes with TTL expiry.

GeoJSON Point fields use sparse 2dsphere indexes and only approximate consented coordinates. Public DTOs never expose exact birth dates, credentials, token hashes or residential locations. Block filtering and conversation authorization must run server-side.

## Phases

1. Foundation: monorepo, API liveness/readiness, Mongo connection, design tokens, navigation and reference UI.
2. Auth: verified email, rotating sessions, recovery, onboarding, media and account lifecycle.
3. Activities: dynamic categories, CRUD, filters, ownership and discovery.
4. Matching: mutual eligibility, explainable rankings, atomic mutual interest and tests.
5. Messaging/safety: authorized sockets, history, moderation and notifications.
6. Admin/launch: isolated admin roles, retention jobs, physical device testing and deployment.

Do not infer romantic consent from practical activity interest. Preview matches are simulations, never real consent. See README for current completion and external-service limitations.
