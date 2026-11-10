# Photo upload storage and troubleshooting

All new profile, Moment and chat photo uploads use shared automatic JPEG compression. The app starts at a maximum 1600-pixel edge, reduces quality and then dimensions as needed, and checks actual encoded bytes until the image is strictly below 100,000 bytes. The API independently applies the same byte ceiling before storage and strips metadata. Native uploads use a file URI directly; web uploads use a Blob with a generated multipart boundary. Documents sent in chat retain their original format and size limits.

Profiles allow up to six photos. The profile editor supports selecting multiple photos, viewing six slots, choosing a main photo and deleting photos. Other profile photo entry points stop at six, and the API rejects a seventh even for concurrent uploads. Compression applies to new uploads; existing stored photos are retained.

The backend accepts one `photo` field, up to 5 MB. It also accepts the previous raw JPEG/PNG/WebP request format for compatibility. Sharp validates and normalizes the actual image bytes and removes metadata before storage. Selection permits source files up to 30 MB because they are resized before transfer. HEIC/HEIF conversion depends on the device's decoder; if a file cannot be opened locally, select a JPEG/PNG or a fresh export of the photo.

## Cloudinary configuration

Keep all credentials only in `apps/api/.env`:

```dotenv
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
PHOTO_STORAGE=auto
```

`auto` uses Cloudinary when credentials are present. `cloudinary` requires those credentials. `mongodb` explicitly uses the original database storage. With no Cloudinary credentials, auto mode uses MongoDB. Partial credentials fail with a clear error rather than silently ignoring the configuration.

New Cloudinary uploads use the `authenticated` delivery type. MongoDB stores the owner and private Cloudinary ID; the ID and signed delivery URLs are not returned to clients. The API checks ownership or discovery eligibility/block rules before fetching the image from Cloudinary. Deleting a photo removes the associated Cloudinary asset. Existing images stored in MongoDB continue to work without migration.

See [Cloudinary authenticated assets](https://cloudinary.com/documentation/control_access_to_media#authenticated_media_assets) and [Node stream uploads](https://cloudinary.com/documentation/node_image_and_video_upload#the_upload_stream_method).

## Verify the connection

```cmd
cd /d D:\Along\apps\api
npm run cloudinary:check
```

This uploads a small generated solid-color test image privately, reads it back, and deletes it immediately. It does not use member photos or create MongoDB users. Credentials and signed URLs are not printed.

## After updating the app

Restart Expo and reselect the photo so the new conversion/upload path runs:

```cmd
cd /d D:\Along
npm run mobile -- --clear
```

Keep the API running with `npm run api`. Its development watcher reloads backend `.env` changes. If running compiled API code with `npm start`, build it first and restart it.

If the app says the image cannot be opened **on the device**, the local URI may have expired or the format may not be supported; select the photo again or export it as JPEG. A **Cloudinary upload failed** message means the backend reached the storage stage and credentials/connectivity need checking. The old backend decoder error is avoided by converting the image before upload and using multipart transfer.

Verification on 26 October 2026: live configured Cloudinary private upload/readback/delete succeeded. Browser QA passed JPEG conversion and multipart upload through onboarding. Automated upload tests cover authenticated storage, normalized content, file limits, provider failures, privacy and owner-only removal. Physical Expo Go photo selection/upload still needs confirmation on the user's device.

Discover loads protected photo bytes with bearer authentication and refreshes an expired session once. Web displays a temporary blob URL; native displays a local data URI, avoiding a separate authenticated request from the native image cache. Temporary sources are discarded when the photo changes or unmounts. Failed requests offer **Retry photo**. Existing uploads do not need to be uploaded again.

Discover verification: all three existing Cloudinary images and their profile references were readable through the running API. Browser QA simulated a 401 and then a 503, verified one session refresh, clicked retry, and required a decoded image with nonzero natural width. Mobile lint, mobile/API type checks, and Android/iOS bundle exports passed. Physical device rendering remains unverified.
