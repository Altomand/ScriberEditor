// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

import {JournalStore} from "./JournalTypes"

const KEY_BUFFER = "journal:buffer"

/**
 * v1 single-buffer persistence backed by Lens Studio's PersistentStorageSystem.
 * The entire buffer text lives at one key; load/save/clear act on the whole
 * thing. v2 will move to per-entry keys + an index, plus an optional cloud
 * mirror — see DESIGN.md "Future Plans".
 */
export class LocalJournalStore implements JournalStore {
    private store: GeneralDataStore

    constructor() {
        this.store = global.persistentStorageSystem.store
    }

    public load(): string {
        if (!this.store.has(KEY_BUFFER)) return ""
        try {
            return this.store.getString(KEY_BUFFER) || ""
        } catch (e) {
            print("LocalJournalStore: failed to read buffer: " + e)
            return ""
        }
    }

    public save(text: string): void {
        this.store.putString(KEY_BUFFER, text || "")
    }

    public clear(): void {
        if (this.store.has(KEY_BUFFER)) this.store.remove(KEY_BUFFER)
    }
}
