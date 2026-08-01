// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// GitHub access using the OAuth DEVICE FLOW (no client secret, no redirect
// URI): the lens requests a short user code, the wearer enters it at
// github.com/login/device on their phone, and the lens polls until GitHub
// grants a token. Documents are stored as .txt files in a configured repo
// via the contents API (create/update/list/download).
//
// Setup (github.com → Settings → Developer settings → OAuth Apps):
//   1. New OAuth App (any valid homepage/callback URL — device flow ignores
//      them), tick "Enable Device Flow".
//   2. Paste the app's Client ID into this component's `clientId` input.
// That's the only required config: documents default to a private
// <signed-in-user>/ScriberEditor-Docs repo, auto-created on first save, so
// every user gets their own storage. repoOwner/repoName/branch/folder are
// optional overrides for pointing at a specific shared repo instead.
//
// Like GoogleDriveStore, everything is simulated in the editor preview
// (`simulateInEditor`), since the polling flow only makes sense on device.

import {DriveFile, ensureNativeRequest, toNative} from "./GoogleDriveStore"

const DEVICE_CODE_URI = "https://github.com/login/device/code"
const DEVICE_TOKEN_URI = "https://github.com/login/oauth/access_token"
const API_BASE = "https://api.github.com"

const TOKEN_KEY_PREFIX = "github:token:"     // + clientId
const LOGIN_KEY_PREFIX = "github:login:"     // + clientId
const MAP_KEY_PREFIX = "github:path:"        // docId -> repo path
const DEFAULT_REPO_NAME = "ScriberEditor-Docs"

@component
export class GitHubStore extends BaseScriptComponent {

    @input
    @hint("GitHub OAuth App client id (Developer settings → OAuth Apps; 'Enable Device Flow' must be ticked)")
    clientId: string = ""

    @input
    @hint("OAuth scope. 'repo' = private+public repos; 'public_repo' = public only")
    scopes: string = "repo"

    @input
    @hint("Optional override: repo owner (user/org). Empty = the signed-in user's own account")
    repoOwner: string = ""

    @input
    @hint("Repo the .txt documents live in. Auto-created (private) in the user's account on first save if missing")
    repoName: string = "ScriberEditor-Docs"

    @input
    @hint("Branch to read/write (empty = the repo's default branch)")
    branch: string = ""

    @input
    @hint("Folder inside the repo for documents (empty = repo root)")
    folder: string = ""

    @input
    @hint("In Lens Studio preview, fake sign-in and files so the whole flow is testable")
    simulateInEditor: boolean = true

    private internetModule: InternetModule = require("LensStudio:InternetModule")
    private token: string = ""
    private login: string = ""       // signed-in user's GitHub login
    private repoChecked: boolean = false
    private pollEvent: DelayedCallbackEvent = null
    private simFiles: { [path: string]: { name: string, body: string } } = {}

    onAwake() {
        const store = global.persistentStorageSystem.store
        const tKey = TOKEN_KEY_PREFIX + this.clientId
        if (store.has(tKey)) this.token = store.getString(tKey) || ""
        const lKey = LOGIN_KEY_PREFIX + this.clientId
        if (store.has(lKey)) this.login = store.getString(lKey) || ""
    }

    private simulated(): boolean {
        return this.simulateInEditor && global.deviceInfoSystem.isEditor()
    }

    // Only the app-level client id is required; the repo defaults to a
    // private <user>/ScriberEditor-Docs auto-created per signed-in account.
    public isConfigured(): boolean {
        return this.simulated() || this.clientId.length > 0
    }

    public isSignedIn(): boolean {
        return this.simulated() || this.token.length > 0
    }

    public signOut(): void {
        this.token = ""
        this.login = ""
        this.repoChecked = false
        global.persistentStorageSystem.store.remove(TOKEN_KEY_PREFIX + this.clientId)
        global.persistentStorageSystem.store.remove(LOGIN_KEY_PREFIX + this.clientId)
    }

    // --- device-flow sign-in ------------------------------------------------

    /**
     * Start the device flow. `onUserCode` fires once GitHub issues the code
     * the wearer must enter at the verification URL (shown in the popup).
     * Resolves when GitHub grants the token; rejects on deny/expiry.
     */
    public signIn(onUserCode: (code: string, uri: string) => void): Promise<void> {
        if (this.simulated()) {
            print("GitHubStore: simulated sign-in.")
            return Promise.resolve()
        }
        if (!this.isConfigured()) {
            return Promise.reject("Set clientId/repoOwner/repoName on GitHubStore")
        }
        ensureNativeRequest()
        const body = "client_id=" + encodeURIComponent(this.clientId)
            + "&scope=" + encodeURIComponent(this.scopes)
        const req = new Request(DEVICE_CODE_URI, {
            method: "POST", body: body,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        })
        return this.internetModule.fetch(toNative(req)).then((res: any) => {
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("Device code request failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((j: any) => {
            if (!j.device_code) throw new Error("No device code in response: " + JSON.stringify(j))
            const verifyUri = j.verification_uri || "https://github.com/login/device"
            print("GitHubStore: user code " + j.user_code + " at " + verifyUri)
            onUserCode(j.user_code, verifyUri)
            // Best effort: open the verification page on the phone.
            try {
                const dl: any = require("LensStudio:DeepLinkModule")
                dl.openUri(verifyUri)
            } catch (e) {}
            return this.pollForToken(j.device_code, Math.max(5, j.interval || 5), j.expires_in || 900)
        }).then(() => {
            // Resolve who signed in so the default repo lands in their account.
            return this.fetchLogin().then(() => {})
        })
    }

    private pollForToken(deviceCode: string, intervalSec: number, expiresInSec: number): Promise<void> {
        const deadline = getTime() + expiresInSec
        return new Promise<void>((resolve, reject) => {
            const poll = () => {
                if (getTime() > deadline) {
                    reject("Sign-in code expired — try again")
                    return
                }
                ensureNativeRequest()
                const body = "client_id=" + encodeURIComponent(this.clientId)
                    + "&device_code=" + encodeURIComponent(deviceCode)
                    + "&grant_type=urn:ietf:params:oauth:grant-type:device_code"
                const req = new Request(DEVICE_TOKEN_URI, {
                    method: "POST", body: body,
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    },
                })
                this.internetModule.fetch(toNative(req)).then((res: any) => res.json()).then((j: any) => {
                    if (j.access_token) {
                        this.token = j.access_token
                        global.persistentStorageSystem.store.putString(
                            TOKEN_KEY_PREFIX + this.clientId, this.token)
                        print("GitHubStore: signed in.")
                        resolve()
                    } else if (j.error === "authorization_pending") {
                        schedule(intervalSec)
                    } else if (j.error === "slow_down") {
                        schedule(intervalSec + 5)
                    } else if (j.error) {
                        reject("GitHub sign-in: " + j.error)
                    } else {
                        schedule(intervalSec)
                    }
                }).catch((e: any) => {
                    // transient network error — keep polling
                    print("GitHubStore: poll error, retrying: " + e)
                    schedule(intervalSec)
                })
            }
            const schedule = (sec: number) => {
                this.pollEvent = this.createEvent("DelayedCallbackEvent")
                this.pollEvent.bind(poll)
                this.pollEvent.reset(sec)
            }
            schedule(intervalSec)
        })
    }

    // --- repo contents ------------------------------------------------------

    // An expired/revoked token comes back as 401 — clear it so the next
    // action re-prompts sign-in instead of failing forever.
    private check401(res: any): void {
        if (res.status === 401) {
            this.signOut()
            throw new Error("GitHub session expired — sign in again")
        }
    }

    private apiHeaders(): { [k: string]: string } {
        return {
            "Authorization": "Bearer " + this.token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "ScriberEditor-Lens",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    }

    private repoNameEff(): string {
        return this.repoName || DEFAULT_REPO_NAME
    }

    /** Repo owner: the explicit override, else the signed-in user's login. */
    private ownerPromise(): Promise<string> {
        if (this.repoOwner) return Promise.resolve(this.repoOwner)
        if (this.login) return Promise.resolve(this.login)
        return this.fetchLogin()
    }

    private fetchLogin(): Promise<string> {
        ensureNativeRequest()
        return this.internetModule.fetch(toNative(new Request(API_BASE + "/user", {
            method: "GET", headers: this.apiHeaders(),
        }))).then((res: any) => {
            this.check401(res)
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("GitHub user lookup failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((j: any) => {
            this.login = j.login
            global.persistentStorageSystem.store.putString(LOGIN_KEY_PREFIX + this.clientId, this.login)
            print("GitHubStore: signed in as " + this.login)
            return this.login
        })
    }

    /**
     * Make sure the target repo exists. When it's the signed-in user's own
     * account (the default), a missing repo is auto-created as private.
     */
    private ensureRepo(owner: string): Promise<void> {
        if (this.repoChecked) return Promise.resolve()
        ensureNativeRequest()
        const url = API_BASE + "/repos/" + owner + "/" + this.repoNameEff()
        return this.internetModule.fetch(toNative(new Request(url, {
            method: "GET", headers: this.apiHeaders(),
        }))).then((res: any) => {
            this.check401(res)
            if (res.ok) { this.repoChecked = true; return }
            if (res.status !== 404) return res.text().then((t: string) => {
                throw new Error("GitHub repo check failed: " + res.status + " " + t)
            })
            if (owner !== this.login) {
                throw new Error("Repo " + owner + "/" + this.repoNameEff() + " not found")
            }
            const headers = this.apiHeaders()
            headers["Content-Type"] = "application/json"
            const payload = JSON.stringify({
                name: this.repoNameEff(), private: true,
                description: "Documents saved from ScriberEditor",
            })
            return this.internetModule.fetch(toNative(new Request(API_BASE + "/user/repos", {
                method: "POST", body: payload, headers: headers,
            }))).then((cres: any) => {
                this.check401(cres)
                if (!cres.ok) return cres.text().then((t: string) => {
                    throw new Error("GitHub repo create failed: " + cres.status + " " + t)
                })
                this.repoChecked = true
                print("GitHubStore: created repo " + owner + "/" + this.repoNameEff())
            })
        })
    }

    private contentsUrl(owner: string, path: string): string {
        let url = API_BASE + "/repos/" + owner + "/" + this.repoNameEff()
            + "/contents/" + encodeURIComponent(path).replace(/%2F/g, "/")
        if (this.branch) url += "?ref=" + encodeURIComponent(this.branch)
        return url
    }

    private docPath(name: string): string {
        return this.folder ? this.folder.replace(/\/+$/, "") + "/" + name : name
    }

    /** Save a document as <title>.txt; updates the same file on re-save. */
    public saveTextFile(docId: string, title: string, body: string): Promise<string> {
        const name = this.sanitizeName(title) + ".txt"
        if (this.simulated()) {
            const path = "sim/" + docId + ".txt"
            this.simFiles[path] = { name: name, body: body }
            print("GitHubStore: simulated save '" + name + "' (" + body.length + " chars)")
            return Promise.resolve(path)
        }
        const store = global.persistentStorageSystem.store
        const mapKey = MAP_KEY_PREFIX + docId
        const path = store.has(mapKey) ? store.getString(mapKey) : this.docPath(name)
        ensureNativeRequest()
        let owner = ""
        return this.ownerPromise().then((o: string) => {
            owner = o
            return this.ensureRepo(owner)
        }).then(() => {
            // Fetch the current sha (needed to update; 404 means create).
            return this.internetModule.fetch(toNative(new Request(this.contentsUrl(owner, path), {
                method: "GET", headers: this.apiHeaders(),
            })))
        }).then((res: any) => {
            this.check401(res)
            if (res.status === 404) return null
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("GitHub read failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((existing: any) => {
            const payload: any = {
                message: (existing ? "Update " : "Add ") + name + " from ScriberEditor",
                content: Base64.encode(new TextEncoder().encode(body)),
            }
            if (existing && existing.sha) payload.sha = existing.sha
            if (this.branch) payload.branch = this.branch
            const headers = this.apiHeaders()
            headers["Content-Type"] = "application/json"
            const putUrl = API_BASE + "/repos/" + owner + "/" + this.repoNameEff()
                + "/contents/" + encodeURIComponent(path).replace(/%2F/g, "/")
            return this.internetModule.fetch(toNative(new Request(putUrl, {
                method: "PUT", body: JSON.stringify(payload), headers: headers,
            })))
        }).then((res: any) => {
            this.check401(res)
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("GitHub save failed: " + res.status + " " + t)
            })
            store.putString(mapKey, path)
            print("GitHubStore: saved '" + path + "'")
            return path
        })
    }

    /** Newest-first .txt files in the configured repo folder. */
    public listTextFiles(): Promise<DriveFile[]> {
        if (this.simulated()) {
            const out: DriveFile[] = []
            for (const p in this.simFiles) {
                out.push({ id: p, name: this.simFiles[p].name, modifiedTime: "" })
            }
            for (let i = out.length; i < 6; i++) {
                out.push({ id: "sim/gh_demo_" + i, name: "Repo note " + (i + 1) + ".txt", modifiedTime: "" })
            }
            print("GitHubStore: simulated list -> " + out.length + " files")
            return Promise.resolve(out)
        }
        ensureNativeRequest()
        return this.ownerPromise().then((owner: string) => {
            return this.internetModule.fetch(toNative(new Request(this.contentsUrl(owner, this.folder || ""), {
                method: "GET", headers: this.apiHeaders(),
            })))
        }).then((res: any) => {
            this.check401(res)
            if (res.status === 404) return []   // repo or folder doesn't exist yet
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("GitHub list failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((items: any) => {
            const out: DriveFile[] = []
            if (Array.isArray(items)) {
                for (const it of items) {
                    if (it && it.type === "file" && /\.txt$/i.test(it.name)) {
                        out.push({ id: it.path, name: it.name, modifiedTime: "" })
                    }
                }
            }
            print("GitHubStore: listed " + out.length + " .txt files")
            return out
        })
    }

    public downloadTextFile(path: string): Promise<string> {
        if (this.simulated()) {
            const f = this.simFiles[path]
            const body = f ? f.body
                : "Simulated GitHub document (" + path + ")\n\nThis text stands in for a real repo .txt while testing in the editor."
            return Promise.resolve(body)
        }
        ensureNativeRequest()
        const headers = this.apiHeaders()
        headers["Accept"] = "application/vnd.github.raw+json"
        return this.ownerPromise().then((owner: string) => {
            return this.internetModule.fetch(toNative(new Request(this.contentsUrl(owner, path), {
                method: "GET", headers: headers,
            })))
        }).then((res: any) => {
            this.check401(res)
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("GitHub download failed: " + res.status + " " + t)
            })
            return res.text()
        })
    }

    /** Link an imported doc to its repo path so Save→GitHub updates in place. */
    public rememberPath(docId: string, path: string): void {
        global.persistentStorageSystem.store.putString(MAP_KEY_PREFIX + docId, path)
    }

    private sanitizeName(title: string): string {
        const t = (title || "Untitled").replace(/[\\/:*?"<>|#%]/g, " ").trim()
        return t.length > 0 ? t.slice(0, 80) : "Untitled"
    }
}
