// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Supabase-backed DocumentStore (Snap-hosted). Ported/trimmed from
// bendConduit's CloudStorageManager — text documents only (no image bucket).
//
// Requires:
//   - Packages/SupabaseClient.lspkg installed in this project
//   - a *.supabaseProject asset wired to `supabaseProject` (URL + public token)
//   - a `documents` table: id text PK, user_id text, title text, body text,
//     created int8, updated int8, is_public bool — RLS allowing anon r/w.
//   - a `document_cools` table: document_id text, user_id text, UNIQUE(document_id,user_id)
//     — one row per (doc,user) that cooled it; count of rows = cool points.
// Degrades to a no-op (DocumentManager falls back to local) if unconfigured.

import {DocumentRecord, DocumentStore, PublicDocumentStore} from "./DocumentTypes"

@component
export class CloudDocumentStore extends BaseScriptComponent implements DocumentStore, PublicDocumentStore {

    @input
    @allowUndefined
    @hint("Supabase Project asset (drag SupabaseProject Scriber here). Required — snapcloud authorizes by the referenced asset.")
    supabaseProject: SupabaseProject

    @input
    @hint("Documents table name")
    tableName: string = "documents"

    @input
    @hint("Per-(doc,user) cool rows table name")
    coolsTableName: string = "document_cools"

    @input
    @hint("DEBUG: force a user id (simulate a second user). Empty = real snapcloud auth.")
    forceUserId: string = ""

    private client: any = null
    private currentUserId: string = "anonymous"
    private ready: Promise<void> = null

    onAwake(): void {
        this.createEvent("OnStartEvent").bind(() => this.initSupabase())
    }

    private initSupabase(): void {
        if (!this.supabaseProject) {
            print("CloudDocumentStore: no Supabase project assigned — cloud disabled")
            this.ready = Promise.reject("no-project")
            this.ready.catch(() => {})
            return
        }
        const url = this.supabaseProject.url
        const token = this.supabaseProject.publicToken
        try {
            // Resolve the Supabase package; tolerate a duplicate-named copy
            // ("SupabaseClient 2.lspkg") created when importing via the GUI.
            let mod: any = null
            try { mod = require("SupabaseClient.lspkg/supabase-snapcloud") }
            catch (e1) {
                try { mod = require("SupabaseClient 2.lspkg/supabase-snapcloud") }
                catch (e2) { throw e1 }
            }
            const createClient = mod.createClient
            this.client = createClient(url, token)
            print("CloudDocumentStore: client created")
            this.ready = this.authenticate()
        } catch (e) {
            print("CloudDocumentStore: init failed: " + e)
            this.ready = Promise.reject(e)
            this.ready.catch(() => {})
        }
    }

    private authenticate(): Promise<void> {
        if (this.forceUserId && this.forceUserId.length > 0) {
            this.currentUserId = this.forceUserId
            print("CloudDocumentStore: forced user " + this.currentUserId)
            return Promise.resolve()
        }
        return new Promise<void>((resolve) => {
            try {
                this.client.auth.signInWithIdToken({ provider: "snapchat", token: "" })
                    .then((result: any) => {
                        if (result && result.data && result.data.user) {
                            this.currentUserId = result.data.user.id
                        } else {
                            this.currentUserId = "anonymous_" + Date.now()
                        }
                        print("CloudDocumentStore: user " + this.currentUserId)
                        resolve()
                    })
                    .catch((err: any) => {
                        this.currentUserId = "anonymous_" + Date.now()
                        print("CloudDocumentStore: auth fallback (" + err + ")")
                        resolve()
                    })
            } catch (e) {
                this.currentUserId = "anonymous_" + Date.now()
                resolve()
            }
        })
    }

    public getCurrentUserId(): string {
        return this.currentUserId
    }

    private ensure(): Promise<void> {
        if (!this.ready) return Promise.reject("not-initialized")
        return this.ready
    }

    public list(): Promise<DocumentRecord[]> {
        return this.ensure().then(() =>
            this.client.from(this.tableName)
                .select("*")
                .eq("user_id", this.currentUserId)
                .order("updated", { ascending: false })
                .limit(100)
        ).then((res: any) => {
            if (res && res.error) throw res.error
            return (res && res.data ? res.data : []) as DocumentRecord[]
        })
    }

    public load(id: string): Promise<DocumentRecord | null> {
        return this.ensure().then(() =>
            this.client.from(this.tableName).select("*").eq("id", id).limit(1)
        ).then((res: any) => {
            if (res && res.error) throw res.error
            const rows = res && res.data ? res.data : []
            return rows.length > 0 ? (rows[0] as DocumentRecord) : null
        })
    }

    public save(doc: DocumentRecord): Promise<void> {
        return this.ensure().then(() => {
            const row = {
                id: doc.id, user_id: this.currentUserId, title: doc.title,
                body: doc.body, created: doc.created, updated: doc.updated,
                is_public: !!doc.is_public,
            }
            return this.client.from(this.tableName).upsert(row, { onConflict: "id" })
        }).then((res: any) => {
            if (res && res.error) throw res.error
        })
    }

    public remove(id: string): Promise<void> {
        return this.ensure().then(() =>
            this.client.from(this.tableName).delete().match({ id: id, user_id: this.currentUserId })
        ).then((res: any) => {
            if (res && res.error) throw res.error
        })
    }

    // ---- Public list + cool points (PublicDocumentStore) ----

    /** Every public doc (all users), with cool tally attached, ranked by cool_points desc. */
    public listPublic(): Promise<DocumentRecord[]> {
        return this.ensure().then(() =>
            this.client.from(this.tableName)
                .select("*")
                .eq("is_public", true)
                .limit(100)
        ).then((res: any) => {
            if (res && res.error) throw res.error
            const rows = (res && res.data ? res.data : []) as DocumentRecord[]
            if (rows.length === 0) return rows
            const ids: string[] = []
            for (const r of rows) { if (r && r.id) ids.push(r.id) }
            return this.client.from(this.coolsTableName)
                .select("document_id, user_id")
                .in("document_id", ids)
                .then((cRes: any) => {
                    const cools = (cRes && cRes.data) ? cRes.data : []
                    const countById: { [k: string]: number } = {}
                    const mineById: { [k: string]: boolean } = {}
                    for (const c of cools) {
                        if (!c || !c.document_id) continue
                        countById[c.document_id] = (countById[c.document_id] || 0) + 1
                        if (c.user_id === this.currentUserId) mineById[c.document_id] = true
                    }
                    for (const r of rows) {
                        r.cool_points = countById[r.id] || 0
                        r.user_cooled = !!mineById[r.id]
                    }
                    rows.sort((a, b) => {
                        const d = (b.cool_points || 0) - (a.cool_points || 0)
                        return d !== 0 ? d : (b.updated || 0) - (a.updated || 0)
                    })
                    print("CloudDocumentStore: listPublic -> " + rows.length + " docs")
                    return rows
                })
                .catch((cErr: any) => {
                    print("CloudDocumentStore: listPublic cools error: " + cErr)
                    for (const r of rows) { r.cool_points = 0; r.user_cooled = false }
                    return rows
                })
        })
    }

    /** Add or remove the current user's cool on a doc (one per user). */
    public setCool(docId: string, cooled: boolean): Promise<void> {
        return this.ensure().then(() => {
            if (cooled) {
                const row = { document_id: docId, user_id: this.currentUserId }
                return this.client.from(this.coolsTableName)
                    .upsert(row, { onConflict: "document_id,user_id" })
            }
            return this.client.from(this.coolsTableName)
                .delete().match({ document_id: docId, user_id: this.currentUserId })
        }).then((res: any) => {
            if (res && res.error) throw res.error
            print("CloudDocumentStore: cool " + (cooled ? "set" : "removed") + " for " + docId)
        })
    }
}
