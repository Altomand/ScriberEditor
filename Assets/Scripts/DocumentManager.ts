// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Central owner of "which document is open and its buffer". Replaces
// JournalController's single-buffer role (autosave logic moved here). New
// documents start blank with an editable title (the title field sets it via
// setTitle). Persists to a local store always; mirrors to a cloud store when
// wired.

import Event from "./Event"
import {DocumentRecord, DocumentStore, deriveTitle, makeDocId} from "./DocumentTypes"
import {LocalDocumentStore} from "./LocalDocumentStore"

@component
export class DocumentManager extends BaseScriptComponent {

    @input
    @allowUndefined
    @hint("Optional CloudDocumentStore component (Supabase). If unset, local-only.")
    cloudStore: any

    @input
    @hint("Save documents to the cloud store when available")
    useCloud: boolean = true

    @input
    @hint("Seconds of idle before autosaving an already-saved document")
    autosaveDelay: number = 1.5

    @input
    @hint("Title given to freshly created documents (editable in the title field)")
    defaultTitle: string = "Doc Title"

    private local: LocalDocumentStore
    private current: DocumentRecord | null = null
    private currentPersisted: boolean = false
    private dirty: boolean = false
    private autosaveEvent: DelayedCallbackEvent

    private onDocChangedEvent = new Event<DocumentRecord>()
    private onListChangedEvent = new Event<void>()
    public onDocChanged = this.onDocChangedEvent.publicApi()
    public onListChanged = this.onListChangedEvent.publicApi()

    onAwake() {
        this.local = new LocalDocumentStore()
        this.createEvent("OnStartEvent").bind(() => this.init())
        this.createEvent("OnDestroyEvent").bind(() => this.flushNow())
    }

    private init() {
        this.autosaveEvent = this.createEvent("DelayedCallbackEvent")
        this.autosaveEvent.bind(() => this.flushNow())
        this.local.migrateLegacyBuffer(Date.now(), makeDocId, deriveTitle)
    }

    private cloud(): DocumentStore | null {
        return (this.useCloud && this.cloudStore) ? (this.cloudStore as DocumentStore) : null
    }

    // --- document lifecycle ------------------------------------------------
    public newDocument(): DocumentRecord {
        const now = Date.now()
        const doc: DocumentRecord = {
            id: makeDocId(now), user_id: "",
            title: this.defaultTitle || "Doc Title",
            body: "", created: now, updated: now,
            is_public: false,
        }
        this.current = doc
        this.currentPersisted = false
        this.dirty = true
        this.onDocChangedEvent.invoke(doc)
        return doc
    }

    /** Set the current document's title (from the title field). */
    public setTitle(title: string): void {
        if (!this.current) this.newDocument()
        this.current.title = title
        this.markDirty()
    }

    /**
     * Open text fetched from an external source (e.g. a Google Drive .txt) as
     * a fresh unsaved document. Like newDocument, it only persists locally on
     * an explicit Save.
     */
    public openImported(body: string, title?: string): DocumentRecord {
        const now = Date.now()
        const doc: DocumentRecord = {
            id: makeDocId(now), user_id: "",
            title: (title && title.trim().length > 0) ? title.trim() : deriveTitle(body),
            body: body, created: now, updated: now, is_public: false,
        }
        this.current = doc
        this.currentPersisted = false
        this.dirty = true
        this.onDocChangedEvent.invoke(doc)
        return doc
    }

    public openDocument(id: string): Promise<void> {
        const src = this.cloud() || this.local
        return src.load(id).then((doc) => {
            if (!doc) {
                print("DocumentManager: openDocument missing " + id)
                return
            }
            this.current = doc
            this.currentPersisted = true
            this.dirty = false
            this.onDocChangedEvent.invoke(doc)
        })
    }

    public getCurrentDoc(): DocumentRecord | null {
        return this.current
    }

    public getBuffer(): string {
        return this.current ? this.current.body : ""
    }

    /** Apply a keypress to the current document buffer. Returns true if changed. */
    public appendKey(key: string): boolean {
        // Typing with no open document lazily starts a new one.
        if (!this.current) this.newDocument()
        if (key === "BACKSPACE") {
            if (this.current.body.length === 0) return false
            this.current.body = this.current.body.slice(0, -1)
        } else if (key === "ESC") {
            return false
        } else if (key.indexOf("[0x") === 0) {
            return false
        } else {
            this.current.body += key
        }
        this.markDirty()
        return true
    }

    public listDocuments(): Promise<DocumentRecord[]> {
        const c = this.cloud()
        if (c) {
            return c.list().catch((e) => {
                print("DocumentManager: cloud list failed, using local: " + e)
                return this.local.list()
            })
        }
        return this.local.list()
    }

    /** Public docs from all users (cloud only), ranked by cool points. */
    public listPublicDocuments(): Promise<DocumentRecord[]> {
        const c = this.cloud() as any
        if (c && typeof c.listPublic === "function") {
            return c.listPublic().catch((e: any) => {
                print("DocumentManager: listPublic failed: " + e)
                return [] as DocumentRecord[]
            })
        }
        return Promise.resolve([] as DocumentRecord[])
    }

    /** Set/clear the current user's cool on a public doc. Optimistic; no list rebuild. */
    public coolDocument(id: string, cooled: boolean): Promise<void> {
        const c = this.cloud() as any
        if (c && typeof c.setCool === "function") return c.setCool(id, cooled)
        return Promise.resolve()
    }

    /**
     * Explicit save (Save button / empty-state). Persists local + cloud.
     * `isPublic` (from the Editor's Private/Public switch) sets visibility;
     * omitted (autosave) preserves the doc's existing visibility.
     */
    public saveCurrent(isPublic?: boolean): Promise<void> {
        if (!this.current) return Promise.resolve()
        // The title comes from the title field; only fall back to deriving it
        // from the body for docs that somehow have none.
        if (!this.current.title || this.current.title.trim().length === 0) {
            this.current.title = deriveTitle(this.current.body)
        }
        this.current.updated = Date.now()
        if (isPublic !== undefined) this.current.is_public = isPublic
        else this.current.is_public = !!this.current.is_public
        this.dirty = false
        const doc = this.current
        return this.local.save(doc).then(() => {
            const c = this.cloud()
            return c ? c.save(doc) : Promise.resolve()
        }).then(() => {
            this.currentPersisted = true
            this.onListChangedEvent.invoke()
        }).catch((e) => {
            print("DocumentManager: saveCurrent failed: " + e)
        })
    }

    public deleteDocument(id: string): Promise<void> {
        return this.local.remove(id).then(() => {
            const c = this.cloud()
            return c ? c.remove(id) : Promise.resolve()
        }).then(() => this.onListChangedEvent.invoke())
    }

    // --- autosave ----------------------------------------------------------
    private markDirty(): void {
        this.dirty = true
        if (this.autosaveEvent) this.autosaveEvent.reset(this.autosaveDelay)
    }

    private flushNow(): void {
        // Only autosave documents that have already been explicitly saved; new
        // documents persist only on an explicit Save (per spec).
        if (!this.dirty || !this.current || !this.currentPersisted) return
        this.saveCurrent()
    }

}
