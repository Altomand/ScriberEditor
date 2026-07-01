// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Persists virtual-keyboard key-swaps (as coordinate pairs) and re-applies them
// to LAYOUT at startup. Stored as a swap list rather than a full layout so it's
// robust to future layout changes.

import {KeyRef, swapCells} from "./KeyboardLayout"

const KEY = "settings:layoutSwaps"

interface SwapPair {
    a: { section: number, row: number, col: number }
    b: { section: number, row: number, col: number }
}

function readSwaps(): SwapPair[] {
    const store = global.persistentStorageSystem.store
    if (!store.has(KEY)) return []
    try {
        const arr = JSON.parse(store.getString(KEY) || "[]")
        return Array.isArray(arr) ? arr : []
    } catch (e) {
        return []
    }
}

function writeSwaps(swaps: SwapPair[]): void {
    global.persistentStorageSystem.store.putString(KEY, JSON.stringify(swaps))
}

/** Re-apply saved swaps to LAYOUT. Call BEFORE the keyboard builds its keys. */
export function applySavedSwaps(): void {
    const swaps = readSwaps()
    for (const s of swaps) {
        const a: KeyRef = { section: s.a.section, row: s.a.row, col: s.a.col, label: "" }
        const b: KeyRef = { section: s.b.section, row: s.b.row, col: s.b.col, label: "" }
        swapCells(a, b)
    }
    if (swaps.length > 0) print("LayoutOverrides: applied " + swaps.length + " saved swap(s).")
}

/** Persist a new swap (LAYOUT is mutated live by the caller via swapCells). */
export function addSwap(a: KeyRef, b: KeyRef): void {
    const swaps = readSwaps()
    swaps.push({
        a: { section: a.section, row: a.row, col: a.col },
        b: { section: b.section, row: b.row, col: b.col },
    })
    writeSwaps(swaps)
}
