# Along API foundation

All data routes use `/api/v1`. Successful responses contain `{ data }`; discovery also contains `nextCursor`. Errors contain `{ error: { code, message, issues? } }`. Delete and logout routes return 204. Requests are limited to 32 KB; unknown input fields are discarded by validation. Date inputs use ISO formats. Page cursors are ObjectIds, with a maximum of 20 activities per page.

| Method | Path                      | Access / body                                                                          |
| ------ | ------------------------- | -------------------------------------------------------------------------------------- |
| GET    | /health                   | Public process health                                                                  |
| GET    | /ready                    | Public database readiness, 503 until connected                                         |
| POST   | /auth/register            | email, password (10–72 chars), name, birthDate YYYY-MM-DD, adult gate                  |
| POST   | /auth/login               | email, password                                                                        |
| POST   | /auth/refresh             | refreshToken; atomic consumption and replacement                                       |
| POST   | /auth/logout              | refreshToken; revokes refresh capability                                               |
| GET    | /categories               | Active category records                                                                |
| GET    | /users/me                 | Bearer token; private own account and profile                                          |
| PATCH  | /profiles/me              | Bearer token; bio, occupation, city, area, interests                                   |
| GET    | /activities               | Bearer token; optional category, q, cursor; block filtered                             |
| POST   | /activities               | Bearer token, verified email; activity input below                                     |
| GET    | /activities/:id           | Bearer token; active and block filtered                                                |
| PATCH  | /activities/:id           | Owner; partial activity input or status active/paused                                  |
| DELETE | /activities/:id           | Owner; soft deletes                                                                    |
| POST   | /activities/:id/interests | Bearer token, verified email; idempotent interest, no self-interest or blocked creator |
| POST   | /blocks                   | Bearer token; userId; directed block enforced in discovery both ways                   |
| POST   | /reports                  | Bearer token; userId and reason (10–1500 chars)                                        |

Activity input: `{ type: 'need'|'offer'|'together', category: string, title: string, description: string, zone: string, startsAt: ISO datetime, recurring?: boolean, budget?: string }`. The server chooses the creator. Category must be active. Dates must be in the future. Precise addresses are not requested by the UI.

Access tokens expire in 15 minutes, refresh sessions in 30 days. Logging out revokes the refresh token; already-issued access tokens remain valid until expiry. Suspended/deleted accounts fail authentication. Native storage uses SecureStore. JWT algorithms, issuer and audience are pinned. Refresh tokens are random values stored only as SHA-256 hashes on the server.

Not yet implemented: email verification/recovery delivery, account export/deletion, public profile discovery, matching API, conversation API, socket service, moderation admin, notification preferences, media signatures. Registered users remain unverified until that module exists. Do not expose this foundation as a public launch.
