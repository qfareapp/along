# App-wide capture protection

Screenshot and recording protection is **on by default** throughout the native app. The local mobile environment and example both set `EXPO_PUBLIC_SCREEN_CAPTURE_PROTECTION=true`; an absent value also enables protection. Only an explicit `false` development override disables it. Reload the app after changing the setting; restart Expo if it has retained an older environment value. Production bundles inherit protection without requiring an environment flag.

When enabled, the root layout mounts protection for the entire native app lifetime, outside the navigation stack. It uses Expo SDK 58's `expo-screen-capture` with the single `along-app` protection key. Navigating between onboarding, authentication, tabs, details and modals does not disable protection. It applies to signed-in and signed-out screens and phone/tablet layouts.

On Android the native module uses `FLAG_SECURE` to prevent screenshots and recording and blank the recent-apps snapshot. On supported iOS versions it prevents screenshots/recordings; app-switcher protection also hides content when the app becomes inactive. No screenshot listeners or photo-library permissions are required for prevention.

The web component is intentionally a no-op: a website cannot reliably prevent operating-system screenshots or recording. External cameras and compromised devices cannot be controlled by the app.

The new native module must be present in the installed app. Existing standalone/development builds need a new native build; the module is included in SDK 58 Expo Go. A JavaScript reload alone cannot add the module to an older standalone binary.

Before release, test an Android device and iPhone/iPad: attempt hardware screenshots, screen recording, and app switching from onboarding, Discover, Social/photo viewer, plan details, chat and modal screens. Navigate repeatedly and background/resume the app to confirm protection stays active and the interface remains usable. Bundle export and type/lint checks cannot verify operating-system capture behavior.

Reference: https://docs.expo.dev/versions/v58.0.0/sdk/screen-capture/
