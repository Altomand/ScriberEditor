// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

/**
 * v1 SkywriterBLE persistence is a single continuous buffer of org-mode
 * formatted text. Each lens session inserts a new org heading with a
 * timestamp and properties drawer; user-typed content follows the heading
 * as free text. The buffer accumulates across sessions.
 *
 * v2 will split this into multiple named/timestamped entries with cloud
 * sync (Supabase) and org-mode export. The org-formatted v1 buffer is
 * forward-compatible — splitting on ^\\*  headings recovers individual
 * entries when v2 ships.
 */

export interface JournalStore {
    /** Load the current buffer text. Returns "" when no buffer has been saved. */
    load(): string

    /** Persist the buffer text. Overwrites any prior value. */
    save(text: string): void

    /** Delete the persisted buffer entirely. */
    clear(): void
}
