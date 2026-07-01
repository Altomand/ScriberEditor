// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// On-device DocumentStore over global.persistentStorageSystem.store.
// Layout:
//   docs:index      -> JSON array of doc ids (newest-first)
//   docs:doc:<id>   -> JSON DocumentRecord

import {DocumentRecord, DocumentStore} from "./DocumentTypes"

const KEY_INDEX = "docs:index"
const KEY_DOC_PREFIX = "docs:doc:"
const LEGACY_BUFFER_KEY = "journal:buffer"

export class LocalDocumentStore implements DocumentStore {
    private store: GeneralDataStore

    constructor() {
        this.store = global.persistentStorageSystem.store
    }

    private readIndex(): string[] {
        if (!this.store.has(KEY_INDEX)) return []
        try {
            const raw = this.store.getString(KEY_INDEX) || "[]"
            const arr = JSON.parse(raw)
            return Array.isArray(arr) ? arr : []
        } catch (e) {
            print("LocalDocumentStore: index read failed: " + e)
            return []
        }
    }

    private writeIndex(ids: string[]): void {
        this.store.putString(KEY_INDEX, JSON.stringify(ids))
    }

    public list(): Promise<DocumentRecord[]> {
        const ids = this.readIndex()
        const out: DocumentRecord[] = []
        for (const id of ids) {
            const key = KEY_DOC_PREFIX + id
            if (!this.store.has(key)) continue
            try {
                out.push(JSON.parse(this.store.getString(key)) as DocumentRecord)
            } catch (e) {
                print("LocalDocumentStore: doc read failed (" + id + "): " + e)
            }
        }
        out.sort((a, b) => b.updated - a.updated)
        return Promise.resolve(out)
    }

    public load(id: string): Promise<DocumentRecord | null> {
        const key = KEY_DOC_PREFIX + id
        if (!this.store.has(key)) return Promise.resolve(null)
        try {
            return Promise.resolve(JSON.parse(this.store.getString(key)) as DocumentRecord)
        } catch (e) {
            print("LocalDocumentStore: load failed (" + id + "): " + e)
            return Promise.resolve(null)
        }
    }

    public save(doc: DocumentRecord): Promise<void> {
        this.store.putString(KEY_DOC_PREFIX + doc.id, JSON.stringify(doc))
        const ids = this.readIndex()
        if (ids.indexOf(doc.id) === -1) {
            ids.unshift(doc.id)
            this.writeIndex(ids)
        }
        return Promise.resolve()
    }

    public remove(id: string): Promise<void> {
        const key = KEY_DOC_PREFIX + id
        if (this.store.has(key)) this.store.remove(key)
        const ids = this.readIndex().filter(x => x !== id)
        this.writeIndex(ids)
        return Promise.resolve()
    }

    /**
     * One-time migration: if a legacy single-buffer journal exists and there
     * are no documents yet, wrap it as the first document so existing users
     * keep their text. Returns the migrated record (already saved) or null.
     */
    public migrateLegacyBuffer(nowMs: number, makeId: (ms: number) => string,
                               deriveTitle: (body: string) => string): DocumentRecord | null {
        if (this.readIndex().length > 0) return null
        if (!this.store.has(LEGACY_BUFFER_KEY)) return null
        let body = ""
        try {
            body = this.store.getString(LEGACY_BUFFER_KEY) || ""
        } catch (e) {
            return null
        }
        if (body.trim().length === 0) return null
        const doc: DocumentRecord = {
            id: makeId(nowMs), user_id: "", title: deriveTitle(body),
            body: body, created: nowMs, updated: nowMs,
        }
        this.save(doc)
        print("LocalDocumentStore: migrated legacy buffer into doc " + doc.id)
        return doc
    }
}
