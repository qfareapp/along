# Date and time selection

Date/time fields use `DateTimeField` and the shared `ThemedPickerModal` on Android, iOS and web. The panel uses Along's cream background, teal header, coral selections, rounded buttons and a readable selection preview. Cancelling, closing or tapping the backdrop preserves the prior value; confirming commits the draft. Web also supports keyboard entry, Enter/Alt+Down to open and Escape to cancel.

The calendar includes separate month/year navigation, a year grid for quick birth-date selection, disabled unavailable dates, a today indicator, and Today/Tomorrow shortcuts where allowed. The clock offers an hour/minute dial, AM/PM selection, exact-minute input and Morning/Afternoon/Evening shortcuts. Invalid minutes disable confirmation. The footer stays visible while the body scrolls on short screens, and the modal adapts to rotation and the keyboard.

Applied to plan dates/times, commute departure/return times, travel return dates, organizer rescheduling, registration and demo onboarding. Live onboarding collects birthdays once at registration; profile completion reuses the saved date without asking again. Older accounts without a saved birthday see a single birthday field during profile completion. Plan and rescheduling calendars start at today; travel returns cannot be selected before the departure day. Birth-date calendars stop at the adult cutoff. Existing server validation continues to apply.

Values remain local `YYYY-MM-DD` dates and `HH:mm` times. Formatting uses local date parts rather than UTC conversion, preventing calendar days from shifting across time zones. No API payload changes are required.

The selectors now use existing React Native components. The unused system-picker dependency and its config plugin have been removed; the themed UI adds no native dependency.

Validation includes timezone/boundary tests in `tools/date-time-fields.test.ts`, all 12 category-posting flows, real calendar/clock interactions during rescheduling, cancellation, month/year navigation, invalid minutes, AM/PM persistence, birthday year selection through activation, four picker viewport sizes including short landscape, typechecking, lint and native bundle export. Native screen readers and keyboards still need physical-device QA.

`npm run qa:onboarding -- --date-time-only` checks the registration birthday calendar and verifies profile completion does not ask again, through activation. The full older onboarding scenario currently stops at an obsolete match-screen text assertion; this focused mode isolates these checks from that unrelated scenario.
