# Android APK builds

Run EAS commands from `apps/mobile`, which contains `app.json` and `eas.json`.

```powershell
cd D:\Along\apps\mobile
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

The `preview` profile creates a signed, standalone release APK for direct installation. It connects to `https://along-5tiq.onrender.com/api/v1`, disables demo mode, and keeps screenshot protection enabled. The Android package ID is `com.qfareapp.along`. No Metro development server is needed to use this APK.

Use Expo-managed Android signing credentials when prompted. Keep the same signing key for future updates to installed copies. The Expo account must have access to the linked project. After the build finishes, open the provided APK download link on an Android phone, allow installation from that browser if prompted, and install Along.

This profile produces an APK for testing and direct distribution. Google Play submission uses an Android App Bundle and requires a separate store build profile.

References: [Expo APK builds](https://docs.expo.dev/build-reference/apk/), [EAS monorepo setup](https://docs.expo.dev/build-reference/build-with-monorepos/).
