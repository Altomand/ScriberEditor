// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Shared keyboard layout + selection model for the Scriber cross keyboard.
// This mirrors the Scriber controller firmware (LAYOUT) and its custom GATT protocol.
// Used by VirtualKeyboard (to render the 60 key labels) and by the in-lens
// simulator (to synthesize commit packets when no hardware is connected).

// Sections (joystick zones). Must match PROTOCOL.md.
export enum Section {
    Center = 0,
    Top = 1,
    Left = 2,
    Right = 3,
    Bottom = 4,
}

// Commit actions. Must match PROTOCOL.md.
export enum Action {
    Insert = 0,
    Backspace = 1,
    Enter = 2,
    Tab = 3,
    Space = 4,
    CapsToggle = 5,
    Shift = 6,
    Emoji = 7,
}

export const SECTION_ORDER: Section[] = [
    Section.Top, Section.Left, Section.Center, Section.Right, Section.Bottom,
];

export const ROWS = 3;
export const COLS = 4;

// A cell's label for each layer, plus an optional special action.
export interface Cell {
    base: string;      // default-layer glyph / label
    shift: string;     // shifted-layer glyph / label
    action: Action;    // Insert for printable; otherwise the special action
    emoji?: number;    // 1..8 when action === Emoji
}

function ch(base: string, shift: string): Cell {
    return { base, shift, action: Action.Insert };
}
function emoji(n: number): Cell {
    return { base: "E" + n, shift: "E" + n, action: Action.Emoji, emoji: n };
}

// LAYOUT[section][row][col]
export const LAYOUT: Record<number, Cell[][]> = {
    [Section.Top]: [
        [ch("a", "A"), ch("b", "B"), ch("c", "C"), ch("d", "D")],
        [ch("e", "E"), ch("f", "F"), ch("g", "G"), ch("h", "H")],
        [ch("i", "I"), ch("j", "J"), ch("k", "K"), ch("l", "L")],
    ],
    [Section.Left]: [
        [ch("m", "M"), ch("n", "N"), ch("o", "O"), ch("p", "P")],
        [ch("q", "Q"), ch("r", "R"), ch("s", "S"), ch("t", "T")],
        [ch("u", "U"), ch("v", "V"), ch("w", "W"), ch("x", "X")],
    ],
    [Section.Center]: [
        [ch("y", "Y"), ch("z", "Z"), ch("0", ")"), ch("1", "!")],
        [ch("2", "@"), ch("3", "#"), ch("4", "$"), ch("5", "%")],
        [ch("6", "^"), ch("7", "&"), ch("8", "*"), ch("9", "(")],
    ],
    [Section.Right]: [
        [ch("-", "_"), ch("=", "+"), ch("`", "~"), ch("[", "{")],
        [ch("]", "}"), ch("\\", "|"), ch(";", ":"), ch("'", "\"")],
        // NOTE: Right/Row3/Btn4 = A / Tab per the source sketch (likely placeholder).
        [ch(",", "<"), ch(".", ">"), ch("/", "?"),
            { base: "A", shift: "Tab", action: Action.Insert }],
    ],
    [Section.Bottom]: [
        [
            { base: "Caps", shift: "Caps", action: Action.CapsToggle },
            { base: "Shift", shift: "Shift", action: Action.Shift },
            { base: "Bksp", shift: "Bksp", action: Action.Backspace },
            { base: "Enter", shift: "Enter", action: Action.Enter },
        ],
        [{ base: "Space", shift: "Space", action: Action.Space }, emoji(2), emoji(3), emoji(4)],
        [emoji(5), emoji(6), emoji(7), emoji(8)],
    ],
};

export interface SelectionData {
    section: Section;
    row: number;        // 0..2
    shiftPending: boolean;
    capsLock: boolean;
    heldButtons: number; // bitmask bit0..3
}

export interface CommitData {
    section: Section;
    row: number;
    button: number;     // 0..3, or 0xFF for the joystick-click Space
    action: Action;
    shifted: boolean;
    payload: number;    // ASCII code for Insert; emoji index for Emoji
    seq: number;
}

// The resolved label to show on a key cell for the current layer.
export function cellLabel(cell: Cell, shifted: boolean): string {
    return shifted ? cell.shift : cell.base;
}

// A flattened reference to a single key position, for the Settings key-swap UI.
export interface KeyRef {
    section: Section;
    row: number;
    col: number;
    label: string;   // current base-layer label, for the dropdown
}

/** Enumerate every key position with its current label (for dropdowns). */
export function flattenLayout(): KeyRef[] {
    const out: KeyRef[] = [];
    for (const section of SECTION_ORDER) {
        const grid = LAYOUT[section];
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                out.push({ section, row, col, label: grid[row][col].base });
            }
        }
    }
    return out;
}

/** Swap two cells in LAYOUT (used by the Settings key-swap + saved overrides). */
export function swapCells(a: KeyRef, b: KeyRef): void {
    const ga = LAYOUT[a.section], gb = LAYOUT[b.section];
    const tmp = ga[a.row][a.col];
    ga[a.row][a.col] = gb[b.row][b.col];
    gb[b.row][b.col] = tmp;
}

// Map a CommitData to the KeypressData "key" string the existing
// JournalController/adapter already understand (see BleKeyboard.KeypressData).
export function commitToKeyString(c: CommitData): string {
    switch (c.action) {
        case Action.Backspace: return "BACKSPACE";
        case Action.Enter: return "\n";
        case Action.Tab: return "\t";
        case Action.Space: return " ";
        case Action.CapsToggle: return "";   // no text effect
        case Action.Shift: return "";         // no text effect
        case Action.Emoji: return "";         // emoji handled separately (TODO art)
        case Action.Insert: return String.fromCharCode(c.payload);
        default: return "";
    }
}
