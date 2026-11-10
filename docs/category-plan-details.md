# Category-specific plan creation

Post creation has two steps. Step one collects the title, description, category and need/offer/together choice. Next opens practical fields for the chosen category, followed by the approximate area, date/time, costs and group size.

| Category               | Practical fields                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Office Commute         | Starting area, office/destination area, leaving home time, leaving office time, working days, transport |
| Travel & Holidays      | Starting city, destination, return date, travel mode, optional stay preferences                         |
| Food & Dining          | Meal/outing, cuisine, venue, optional dietary needs                                                     |
| Shopping               | Items to shop for, market/mall, shopping plan                                                           |
| Fitness & Wellness     | Workout, venue, experience level, duration                                                              |
| Movies & Entertainment | Movie/show, venue, format                                                                               |
| Hobbies & Creativity   | Hobby, venue, experience, optional materials                                                            |
| Sports                 | Sport, venue, experience, optional equipment/booking                                                    |
| Learning               | Subject, format, venue, experience                                                                      |
| Social Events          | Event name, venue, event type                                                                           |
| Festivals & Culture    | Occasion, venue, shared activity                                                                        |
| Community Volunteering | Cause, public meeting area, commitment, optional organization                                           |

Drafts survive going back, switching categories and resizing the window within the current creation session. Successful publishing clears them. Fields marked optional can be omitted. Custom admin categories use a public meeting area field. Category labels and availability still come from the existing category service.

Commutes publish as recurring plans. The first working day and departure time determine `startsAt`; working days and return time are stored as structured schedule details. Recurring visibility uses the existing recurring-plan rules; it does not generate daily copies. Travel uses the departure date/time and return day (end of that local day) as `startsAt`/`endsAt`.

The shared, dependency-free `packages/plan-details` module defines fields, labels and validation for mobile and API. `categoryDetails` stores only the selected category's structured values. API create/update validates supplied details, rejects unrelated fields, invalid times/dates/days/durations and oversized values. Older clients and existing posts without `categoryDetails` remain supported. Public activity details include these values and display a labeled summary in live and preview modes.

Include `packages/plan-details` in deployments alongside `apps/api`: compiled API imports reference this shared module. Mobile Metro explicitly watches `packages` because this repository uses separate app installs rather than package-manager workspaces. No dependency installation or database migration is needed.

Verification: `plan-details.test.ts` covers all default categories and malformed values; `activities.test.ts` covers persistence, visibility and owner edits; `qa:plans` publishes all 12 category forms and checks validation, draft retention, stored values and public summaries. `qa:tablet` checks the updated posting flow while resizing. Native gestures/keyboards require device QA.
