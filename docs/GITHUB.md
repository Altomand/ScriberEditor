# GitHub integration (device flow)

Save documents as `.txt` files into a GitHub repo and open existing repo
`.txt` files, authenticated with GitHub's OAuth **device flow** — no client
secret ships in the lens and no redirect URI is needed. The wearer gets a
short code in the popup, enters it at `github.com/login/device` on their
phone, and the lens polls until GitHub grants the token.

## User flows

- **Save → GitHub icon** — the Save button opens four choices: `All Docs`,
  `My Docs`, the Drive icon, and the **GitHub icon**. Picking GitHub commits
  the current document as `<title>.txt` to the configured repo (message
  "Add/Update <name> from ScriberEditor"). Re-saving updates the same file
  (the doc→path mapping persists under `github:path:<docId>`).
- **New Doc → GitHub icon** — the New Doc button opens `Blank Doc`, the
  Drive icon, and the **GitHub icon**, which lists the repo folder's `.txt`
  files in the shared popup. Tapping one downloads it and opens it as a new
  unsaved document; saving it back updates the original repo file.
- **Sign-in** — the popup shows "Sign in with GitHub"; tapping it requests a
  device code, displays "enter code XXXX-XXXX at github.com/login/device",
  best-effort opens that page on the phone via deep link, and polls until
  authorized. The token persists across sessions (`github:token:<clientId>`).

## Pieces

| File | Role |
|---|---|
| `Assets/Scripts/GitHubStore.ts` | Device-flow OAuth + repo contents API: sha-aware create/update (PUT), list folder (filter `.txt`), raw download. Component on `DocBackend`. |
| `Assets/Scripts/GoogleDrivePanel.ts` | The shared popup (now parameterized title / sign-in label), used by both Drive and GitHub flows. |
| `Assets/Scripts/EditorTabController.ts` | The GitHub icon buttons and auth→action orchestration. |

## Setup (developer, once)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
   Homepage/callback must be *valid URLs* but their value doesn't matter
   (device flow ignores them) — the project repo URL works fine.
2. Tick **Enable Device Flow** (on the form or the app's settings page).
3. Copy the **Client ID** into the `clientId` input of the **GitHubStore**
   component on the `DocBackend` object.

That's the only required config. **Each signed-in user gets their own
storage automatically**: documents go to a private `ScriberEditor-Docs`
repo in that user's account, created on first save if it doesn't exist.
`repoOwner` / `repoName` / `branch` / `folder` are optional overrides for
pointing every user at one specific shared repo instead (users then need
push access to it).

Scope defaults to `repo` (needed to create/write the private per-user
repo); `public_repo` works only for public shared-repo setups.

## Preview vs hardware

Like Drive, `simulateInEditor` (default on) fakes sign-in, the file list,
download, and save in Lens Studio preview so the whole UX is testable
without hardware. On Spectacles the real device flow + REST path runs.

## Notes

- All GitHub requests go through the same native-`Request` restoration as
  Drive (see docs/GOOGLE-DRIVE.md "Gotcha") — the Supabase polyfills would
  otherwise break them.
- GitHub OAuth-app user tokens don't expire by default; on a 401 the store
  clears the token and the next action re-prompts sign-in.
