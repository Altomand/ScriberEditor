# Google Drive integration (AuthKit)

Save documents to Google Drive as `.txt` and open existing Drive `.txt` files,
authenticated with Snap's [Auth Kit](https://developers.snap.com/spectacles/spectacles-frameworks/auth-kit/getting-started)
(OAuth2 authorization-code flow with PKCE, deep-linked through the Spectacles App).

## User flows

- **Save → Drive** — the Save button now opens three pills: `All Docs`,
  `My Docs`, and `Drive`. Picking `Drive` uploads the current document as
  `<title>.txt` (title derived from the first content line). Re-saving the
  same document updates the same Drive file instead of creating copies
  (the doc→file mapping persists under `drive:fileId:<docId>`).
- **New Doc → From Drive** — the New Doc button now opens two pills:
  `Blank Doc` (what it always did) and `From Drive`, which lists your Drive
  `.txt` files in a popup (4 per page, ▲/▼ to page, ✕ to close). Tapping a
  file downloads it and opens it as a new unsaved document; saving it back to
  Drive updates the original file.
- **Sign-in** — if you're not signed in, the popup shows a
  "Sign in with Google" pill. OAuth happens in the Spectacles App on your
  phone (no credentials are typed in-lens); the popup waits and then
  continues the action you started.

All popup elements are tappable by finger poke, hand-ray pinch, or the
controller cursor (Interactable targeting mode 7), like the virtual keyboard.

## Pieces

| File | Role |
|---|---|
| `Assets/Scripts/GoogleDriveStore.ts` | AuthKit `OAuth2` wrapper + Drive REST: sign-in state, save (multipart create / media PATCH update), list (`mimeType='text/plain'`), download (`alt=media`). Component on `DocBackend`. |
| `Assets/Scripts/GoogleDrivePanel.ts` | Runtime-built popup: sign-in prompt, pageable file list, status messages. Component on `DocPanel`, panel parented under `EditorViewRoot`. |
| `Assets/Scripts/EditorTabController.ts` | The third Save pill, the two-choice New Doc flow, and the auth→action orchestration. |
| `Assets/Scripts/DocumentManager.ts` | `openImported(body)` — turns downloaded text into a fresh unsaved document. |

## Setup (required once)

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an OAuth client. An **iOS-type client** is recommended (installed-app
   client, no secret, custom-scheme redirect).
2. Enable the **Google Drive API** for the project.
3. Register the redirect URI. Per the AuthKit docs, Google-flavored redirects
   use `com.snap.spectacles:/specslink/oauth2redirect/<LENS_ID>` (published
   lens) — while developing you can leave the component's `redirectUri` input
   empty to use AuthKit's default `.../oauth2redirect/unsecure`.
4. Paste the client id into the `clientId` input of the **GoogleDriveStore**
   component on the `DocBackend` object.

Scopes default to full `https://www.googleapis.com/auth/drive` so the picker
can see *all* your `.txt` files. Switch the `scopes` input to
`https://www.googleapis.com/auth/drive.file` if you only need files this lens
created (lighter permission, but the picker won't see pre-existing files).

## Preview vs hardware

AuthKit's `authorize()` throws in the editor, so `GoogleDriveStore` has a
`simulateInEditor` input (default on): in Lens Studio preview, sign-in
succeeds instantly and the list/download/save calls are faked (a handful of
demo files) so the whole UX is testable without hardware. On Spectacles the
real OAuth + Drive REST path runs. Turn the input off to see the real error
paths in preview.

## Gotcha: Supabase's Web-API polyfills vs the native fetch

The Supabase client (`supabase-snapcloud`, loaded by `CloudDocumentStore`)
**replaces `globalThis.Request` / `Headers` / `Response` with its own
polyfills** when it loads. The native `InternetModule.fetch` rejects those
polyfill objects with `InternalError: Incorrect argument type` — which broke
AuthKit's OAuth token exchange ("exception with host function incorrect
argument type" right after Google sign-in on the phone).

`GoogleDriveStore` works around it by capturing the native `Request` class at
module-load time (all modules load before the Supabase require runs at
OnStart) and restoring it via `ensureNativeRequest()` before every operation
that builds fetch Requests — AuthKit's included — plus a `toNative()` guard
that converts any straggler polyfill via its `toLensStudioRequest()`. Keep
this in mind for any future script that uses `new Request(...)` with the
native fetch while the Supabase package is in the project.

## Verified

- ✅ Compiles; preview logs show `GoogleDrivePanel: built.` and no runtime
  errors; simulated flows exercise sign-in, list, download, and save.
- ❓ Real OAuth + Drive round-trip needs Spectacles + the Spectacles App in
  the foreground, and your own Google OAuth client id.
