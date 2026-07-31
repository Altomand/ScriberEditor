// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Google Drive access over AuthKit's OAuth2 (code flow + PKCE, deep-linked
// through the Spectacles App). Saves the current document as a .txt file,
// lists the user's .txt files, and downloads one for import.
//
// Setup (Google Cloud Console):
//   1. Create an OAuth client of type "iOS" (installed app; no client secret).
//   2. Set its bundle id / custom scheme so the redirect URI
//      com.snap.spectacles:/specslink/oauth2redirect/<LENS_ID> is accepted
//      (use .../unsecure while developing — see the AuthKit docs).
//   3. Paste the client id into this component's `clientId` input.
//
// Real sign-in only works on Spectacles (AuthKit's authorize() throws in the
// editor), so in preview this component fakes the whole Drive round-trip when
// `simulateInEditor` is on — the panel, list, and import flows all run.

const OAuth2 = require("AuthKit.lspkg/Core/OAuth2").OAuth2

// The Supabase client (loaded by CloudDocumentStore at OnStart) replaces
// globalThis.Request/Headers/Response with Web-API polyfills; the native
// InternetModule.fetch then rejects those objects with "InternalError:
// Incorrect argument type", which silently killed AuthKit's token exchange.
// Script modules all load (onAwake) before any OnStartEvent runs, so at this
// point the global Request is still the native one — capture it and restore
// it before every Drive/AuthKit operation that builds fetch Requests.
const NATIVE_REQUEST: any = (globalThis as any).Request

function ensureNativeRequest(): void {
    if (NATIVE_REQUEST && (globalThis as any).Request !== NATIVE_REQUEST) {
        (globalThis as any).Request = NATIVE_REQUEST
    }
}

// Last-resort guard: if a polyfill Request still sneaks through, convert it.
function toNative(req: any): any {
    return (req && typeof req.toLensStudioRequest === "function")
        ? req.toLensStudioRequest() : req
}

const GOOGLE_AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
const DRIVE_FILES_URI = "https://www.googleapis.com/drive/v3/files"
const DRIVE_UPLOAD_URI = "https://www.googleapis.com/upload/drive/v3/files"

const MAP_KEY_PREFIX = "drive:fileId:"   // docId -> Drive file id

export interface DriveFile {
    id: string
    name: string
    modifiedTime: string
}

@component
export class GoogleDriveStore extends BaseScriptComponent {

    @input
    @hint("Google OAuth client id (from Google Cloud Console; iOS-type client)")
    clientId: string = ""

    @input
    @hint("Optional client secret (leave empty for iOS-type clients)")
    clientSecret: string = ""

    @input
    @hint("Redirect URI registered with Google. Empty = AuthKit's default (.../unsecure, dev only). For release use com.snap.spectacles:/specslink/oauth2redirect/<LENS_ID>")
    redirectUri: string = ""

    @input
    @hint("OAuth scopes. Full 'drive' lists all .txt files; 'drive.file' would only see files this lens created")
    scopes: string = "https://www.googleapis.com/auth/drive"

    @input
    @hint("In Lens Studio preview, fake sign-in and Drive files so the whole flow is testable (real auth needs Spectacles)")
    simulateInEditor: boolean = true

    private oauth: any = null
    private internetModule: InternetModule = require("LensStudio:InternetModule")
    private simFiles: { [id: string]: { name: string, body: string } } = {}

    onAwake() {
        // OAuth2 is constructed lazily so a missing clientId only breaks the
        // Drive buttons, never the lens.
    }

    private simulated(): boolean {
        return this.simulateInEditor && global.deviceInfoSystem.isEditor()
    }

    public isConfigured(): boolean {
        return this.simulated() || this.clientId.length > 0
    }

    private getOauth(): any {
        ensureNativeRequest()   // AuthKit builds fetch Requests internally
        if (!this.oauth) {
            const opts: any = {
                clientId: this.clientId,
                authorizationUri: GOOGLE_AUTH_URI,
                tokenUri: GOOGLE_TOKEN_URI,
                authenticationType: "code",
            }
            if (this.clientSecret) opts.clientSecret = this.clientSecret
            if (this.redirectUri) opts.redirectUri = this.redirectUri
            this.oauth = new OAuth2(opts)
        }
        return this.oauth
    }

    public isSignedIn(): boolean {
        if (this.simulated()) return true
        if (!this.isConfigured()) return false
        try {
            return this.getOauth().isAuthorized
        } catch (e) {
            return false
        }
    }

    /** Kick off the OAuth flow (continues in the Spectacles App on the phone). */
    public signIn(): Promise<void> {
        if (this.simulated()) {
            print("GoogleDriveStore: simulated sign-in.")
            return Promise.resolve()
        }
        if (!this.isConfigured()) {
            return Promise.reject("Set the Google clientId on GoogleDriveStore")
        }
        return this.getOauth().authorize(this.scopes).then(() => {
            print("GoogleDriveStore: signed in.")
        })
    }

    public signOut(): void {
        if (this.oauth) this.oauth.signOut()
    }

    private authHeader(): Promise<{ [k: string]: string }> {
        // getAccessToken may refresh internally — needs the native Request too.
        return this.getOauth().getAccessToken().then((t: string) => ({
            "Authorization": "Bearer " + t,
        }))
    }

    // --- save ---------------------------------------------------------------

    /**
     * Save a document body to Drive as <title>.txt. Remembers the Drive file
     * id per document so re-saving updates the same file instead of piling up
     * copies. Returns the Drive file id.
     */
    public saveTextFile(docId: string, title: string, body: string): Promise<string> {
        const name = this.sanitizeName(title) + ".txt"
        if (this.simulated()) {
            const id = "sim_" + docId
            this.simFiles[id] = { name, body }
            print("GoogleDriveStore: simulated save '" + name + "' (" + body.length + " chars)")
            return Promise.resolve(id)
        }
        const existing = this.mappedFileId(docId)
        const p = existing ? this.updateFile(existing, name, body) : this.createFile(name, body)
        return p.then((fileId) => {
            this.rememberFileId(docId, fileId)
            return fileId
        })
    }

    private createFile(name: string, body: string): Promise<string> {
        const boundary = "scriber_boundary_314159"
        const meta = JSON.stringify({ name: name, mimeType: "text/plain" })
        const multipart =
            "--" + boundary + "\r\n" +
            "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
            meta + "\r\n" +
            "--" + boundary + "\r\n" +
            "Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
            body + "\r\n" +
            "--" + boundary + "--"
        return this.authHeader().then((headers) => {
            headers["Content-Type"] = "multipart/related; boundary=" + boundary
            const req = new Request(DRIVE_UPLOAD_URI + "?uploadType=multipart&fields=id", {
                method: "POST", body: multipart, headers: headers,
            })
            return this.internetModule.fetch(toNative(req))
        }).then((res: any) => {
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("Drive create failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((j: any) => {
            print("GoogleDriveStore: created '" + name + "' -> " + j.id)
            return j.id as string
        })
    }

    private updateFile(fileId: string, name: string, body: string): Promise<string> {
        return this.authHeader().then((headers) => {
            headers["Content-Type"] = "text/plain; charset=UTF-8"
            const req = new Request(DRIVE_UPLOAD_URI + "/" + fileId + "?uploadType=media", {
                method: "PATCH", body: body, headers: headers,
            })
            return this.internetModule.fetch(toNative(req))
        }).then((res: any) => {
            // A deleted/missing Drive file falls back to creating a fresh one.
            if (res.status === 404) return this.createFile(name, body)
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("Drive update failed: " + res.status + " " + t)
            })
            return this.renameFile(fileId, name).then(() => {
                print("GoogleDriveStore: updated '" + name + "' (" + fileId + ")")
                return fileId
            })
        })
    }

    private renameFile(fileId: string, name: string): Promise<void> {
        return this.authHeader().then((headers) => {
            headers["Content-Type"] = "application/json; charset=UTF-8"
            const req = new Request(DRIVE_FILES_URI + "/" + fileId, {
                method: "PATCH", body: JSON.stringify({ name: name }), headers: headers,
            })
            return this.internetModule.fetch(toNative(req))
        }).then(() => {})
    }

    // --- list / download ----------------------------------------------------

    /** Newest-first .txt files in the user's Drive. */
    public listTextFiles(): Promise<DriveFile[]> {
        if (this.simulated()) {
            const out: DriveFile[] = []
            for (const id in this.simFiles) {
                out.push({ id: id, name: this.simFiles[id].name, modifiedTime: "" })
            }
            for (let i = out.length; i < 7; i++) {
                out.push({ id: "sim_demo_" + i, name: "Demo note " + (i + 1) + ".txt", modifiedTime: "" })
            }
            print("GoogleDriveStore: simulated list -> " + out.length + " files")
            return Promise.resolve(out)
        }
        const q = encodeURIComponent("mimeType='text/plain' and trashed=false")
        const url = DRIVE_FILES_URI + "?q=" + q
            + "&orderBy=" + encodeURIComponent("modifiedTime desc")
            + "&pageSize=100&fields=" + encodeURIComponent("files(id,name,modifiedTime)")
        return this.authHeader().then((headers) => {
            return this.internetModule.fetch(toNative(new Request(url, { method: "GET", headers: headers })))
        }).then((res: any) => {
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("Drive list failed: " + res.status + " " + t)
            })
            return res.json()
        }).then((j: any) => {
            const files = (j.files || []) as DriveFile[]
            print("GoogleDriveStore: listed " + files.length + " .txt files")
            return files
        })
    }

    public downloadTextFile(fileId: string): Promise<string> {
        if (this.simulated()) {
            const f = this.simFiles[fileId]
            const body = f ? f.body
                : "Simulated Drive document (" + fileId + ")\n\nThis text stands in for a real .txt file while testing in the editor."
            return Promise.resolve(body)
        }
        const url = DRIVE_FILES_URI + "/" + fileId + "?alt=media"
        return this.authHeader().then((headers) => {
            return this.internetModule.fetch(toNative(new Request(url, { method: "GET", headers: headers })))
        }).then((res: any) => {
            if (!res.ok) return res.text().then((t: string) => {
                throw new Error("Drive download failed: " + res.status + " " + t)
            })
            return res.text()
        })
    }

    /** Link an imported doc to its Drive file so Save→Drive updates in place. */
    public rememberFileId(docId: string, fileId: string): void {
        global.persistentStorageSystem.store.putString(MAP_KEY_PREFIX + docId, fileId)
    }

    private mappedFileId(docId: string): string | null {
        const store = global.persistentStorageSystem.store
        const key = MAP_KEY_PREFIX + docId
        return store.has(key) ? store.getString(key) : null
    }

    private sanitizeName(title: string): string {
        const t = (title || "Untitled").replace(/[\\/:*?"<>|]/g, " ").trim()
        return t.length > 0 ? t.slice(0, 80) : "Untitled"
    }
}
