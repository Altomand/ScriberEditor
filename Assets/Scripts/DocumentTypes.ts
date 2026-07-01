// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Document model + storage abstraction for the multi-document editor.
// Local (on-device) and Cloud (Supabase) stores both implement DocumentStore
// so they're drop-in interchangeable.

export interface DocumentRecord {
    id: string;        // "doc_<ts>_<rand>"
    user_id: string;   // filled by the cloud store; "" locally
    title: string;     // derived from the first non-empty body line
    body: string;      // the org-mode buffer
    created: number;   // ms epoch
    updated: number;   // ms epoch
    is_public?: boolean;   // persisted; shared to the public "All Docs" list when true
    // Transient — populated only by listPublic(); never written as columns:
    cool_points?: number;  // count of cools (client-side tally)
    user_cooled?: boolean; // has the current user cooled this doc?
}

export interface DocumentStore {
    /** Newest-first list of documents. */
    list(): Promise<DocumentRecord[]>;
    /** Load one document, or null if missing. */
    load(id: string): Promise<DocumentRecord | null>;
    /** Insert or update (upsert by id). */
    save(doc: DocumentRecord): Promise<void>;
    /** Delete a document. */
    remove(id: string): Promise<void>;
}

/**
 * Optional capability for stores that can serve the cross-user public list and
 * "cool" points. Only the cloud store implements this; local docs are private.
 */
export interface PublicDocumentStore {
    /** All public docs from every user, with cool tally attached, ranked by cool_points desc. */
    listPublic(): Promise<DocumentRecord[]>;
    /** Set/clear the current user's cool on a doc (presence of a row = a cool). */
    setCool(docId: string, cooled: boolean): Promise<void>;
}

/** Derive a card title from a document body (first non-empty, non-heading line). */
export function deriveTitle(body: string): string {
    const lines = body.split("\n");
    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0) continue;
        // Skip org headings/property drawer lines so the title is real content.
        if (line.indexOf("*") === 0) continue;
        if (line.indexOf(":") === 0) continue;
        if (line.indexOf("[") === 0) continue;
        return line.length > 40 ? line.slice(0, 40) + "…" : line;
    }
    return "Untitled";
}

let _idCounter = 0;
/** Generate a unique document id. Avoids Math.random for determinism in tests. */
export function makeDocId(nowMs: number): string {
    _idCounter = (_idCounter + 1) & 0xffff;
    return "doc_" + nowMs + "_" + _idCounter;
}
