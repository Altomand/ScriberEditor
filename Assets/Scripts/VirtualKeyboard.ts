// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Cross-layout virtual keyboard for the Scriber input device. Renders the five
// sections (Top/Left/Center/Right/Bottom) as a plus, each a 3x4 grid of keys,
// and highlights the live section + row (and flashes the committed key) driven
// by BleKeyboard's onSelectionChanged / onCommit events.
//
// Highlighting is text-color based (no per-key quads) so it renders reliably:
//   - dim         = not in the active section
//   - section lit = in the active section
//   - row lit     = in the active section AND row (the candidate keys)
//   - flash       = a key was just committed
//
// A built-in auto-demo (simulate=true) drives the whole thing in Lens Studio
// preview with no hardware, by feeding synthetic packets into BleKeyboard.
//
// Keys are also directly tappable (clickable=true): each key carries a collider
// + SIK Interactable (Direct/Indirect/Poke), so a finger tap, hand-ray pinch,
// or controller cursor commits the key through the same synthetic-packet path
// the demo uses — flash, audio, stats, and typing all behave like hardware.

import {BleKeyboard} from "./BleKeyboard"
import {
    LAYOUT, SECTION_ORDER, Section, Action, ROWS, COLS,
    cellLabel, SelectionData, CommitData,
} from "./KeyboardLayout"
import {applySavedSwaps} from "./LayoutOverrides"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

interface KeyCell {
    section: Section;
    row: number;
    col: number;
    text: Text;
    color: vec4;        // current displayed color (animated)
    target: vec4;       // desired color this frame
    flashUntil: number; // getTime() seconds; >0 means flashing
    hovered: boolean;   // an interactor (finger/cursor) is over this key
}

@component
export class VirtualKeyboard extends BaseScriptComponent {

    @input
    @hint("Scriber/BLE keyboard source for selection + commit events")
    bleKeyboard: BleKeyboard

    @input
    @hint("Run an auto-demo in preview (no hardware needed)")
    simulate: boolean = true

    @input
    @hint("Make every key tappable: finger poke, hand-ray pinch, and the controller cursor all commit the key")
    clickable: boolean = true

    @input
    @allowUndefined
    @hint("Material for the plus background mesh (an unlit material, e.g. the app's UIBox/flat material)")
    backplateMaterial: Material

    @input
    @allowUndefined
    @hint("Optional: read the plus color from this material's baseColor (the main panel background)")
    panelBackgroundMaterial: Material

    @input
    @hint("Plus background color (used if no panelBackgroundMaterial). RGBA")
    bgColor: vec4 = new vec4(0.12, 0.12, 0.14, 0.92)

    @input
    @hint("World scale of the plus background mesh (tune to frame the keys)")
    bgScale: number = 14.0

    @input
    @hint("Local Z offset of the plus background (push behind the keys)")
    bgZ: number = 0.5

    @input
    @allowUndefined
    @hint("Texture: grey plus backplate (screen-space image behind the keys)")
    plusTexture: Texture
    @input
    @allowUndefined
    @hint("Transparent-unlit material (e.g. EmojiCool) — cloned for the plus backplate")
    plusMaterial: Material
    @input
    @hint("Screen-space size of the plus backplate (anchors, ~1.8 frames the keys)")
    plusSize: number = 1.85

    @input
    @allowUndefined
    @hint("Bold font for key labels (e.g. Poppins-Bold)")
    keyFont: Font

    @input
    @hint("Font size for key labels")
    keySize: number = 28

    @input
    @hint("Horizontal spacing between columns (normalized, 0..1)")
    colSpacing: number = 0.13

    @input
    @hint("Vertical spacing between rows (normalized, 0..1)")
    rowSpacing: number = 0.17

    @input
    @hint("Distance of side sections from center (normalized, 0..1)")
    sectionSpread: number = 0.62

    // Colors — the resting keys use the exact editor-text green (same as the
    // "start typing" hint), so unhighlighted labels read as one style with
    // the document text; highlight states climb in brightness from there.
    private readonly DIM = new vec4(0.556, 0.979, 0.0, 1.0);    // base (editor green)
    private readonly SECTION = new vec4(0.78, 1.0, 0.45, 1.0);  // active section
    private readonly ROW = new vec4(0.92, 1.0, 0.75, 1.0);      // active row (candidates)
    private readonly KEY = new vec4(1.0, 1.0, 0.85, 1.0);       // held key
    private readonly FLASH = new vec4(1.0, 1.0, 1.0, 1.0);      // committed (white pop)

    private cells: KeyCell[] = [];
    private selection: SelectionData = {
        section: Section.Center, row: 0, shiftPending: false, capsLock: false, heldButtons: 0,
    };
    private shiftedView: boolean = false;
    private tapSeq: number = 0;

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init());
    }

    private init() {
        applySavedSwaps();   // re-apply persisted key-swaps before building keys
        this.buildPlusBackground();
        this.buildKeys();
        this.refreshLabels();

        if (this.bleKeyboard) {
            if (this.bleKeyboard.onSelectionChanged) {
                this.bleKeyboard.onSelectionChanged.add((s: SelectionData) => this.onSelection(s));
            }
            if (this.bleKeyboard.onCommit) {
                this.bleKeyboard.onCommit.add((c: CommitData) => this.onCommit(c));
            }
        } else {
            print("VirtualKeyboard: bleKeyboard not wired.");
        }

        this.createEvent("UpdateEvent").bind(() => this.update());

        // !== false: a scene serialized before this input existed reads
        // undefined here; tap-to-type should still default ON.
        if (this.clickable !== false) {
            // Defer so the ScreenTransform layout has produced valid world
            // positions before we measure the key pitch for the colliders
            // (same settle-delay pattern as DocsListController's row hits).
            const ev = this.createEvent("DelayedCallbackEvent");
            ev.bind(() => this.installKeyInteraction());
            ev.reset(0.2);
        }

        if (this.simulate) {
            this.startDemo();
        }
    }

    // --- layout ------------------------------------------------------------
    private sectionCenter(section: Section): vec2 {
        switch (section) {
            case Section.Top: return new vec2(0, this.sectionSpread);
            case Section.Bottom: return new vec2(0, -this.sectionSpread);
            case Section.Left: return new vec2(-this.sectionSpread, 0);
            case Section.Right: return new vec2(this.sectionSpread, 0);
            default: return new vec2(0, 0); // Center
        }
    }

    // Single plus-shaped background mesh (built with MeshBuilder, the same
    // technique bendConduit uses for pipes), tinted to the panel background so
    // the keys read clearly. Rendered behind the keys.
    // Grey plus backplate behind the keys. The keyboard is a screen-space UI
    // (Screen Transform), so this is a screen-space Image — a world mesh renders in
    // the wrong space and never shows. The plus shape lives in the texture; the
    // material is a transparent-unlit clone with baseTex swapped (same as the icons).
    private buildPlusBackground() {
        if (!this.plusMaterial || !this.plusTexture) {
            print("VirtualKeyboard: no plus material/texture; skipping plus background.");
            return;
        }
        try {
            const obj = global.scene.createSceneObject("plus_bg");
            obj.setParent(this.getSceneObject());
            const st = obj.createComponent("Component.ScreenTransform") as any;
            st.anchors.setCenter(new vec2(0, 0));
            st.anchors.setSize(new vec2(this.plusSize, this.plusSize));
            st.offsets.setCenter(new vec2(0, 0));
            st.offsets.setSize(new vec2(0, 0));
            const img = obj.createComponent("Component.Image") as any;
            const m = this.plusMaterial.clone();
            m.mainPass.baseTex = this.plusTexture;
            // Match the round icon buttons' disc exactly: icon_newdoc's circle
            // is RGBA(50,53,60,175) and kbd_plus is RGBA(88,94,105,240), so
            // multiply by their ratio (color and alpha) to render identically.
            try { m.mainPass.baseColor = new vec4(0.568, 0.564, 0.571, 0.729); } catch (e) {}
            img.mainMaterial = m;
            img.renderOrder = 0;   // behind the keys (keys render at order 2)
            print("VirtualKeyboard: built plus background (screen-space).");
        } catch (e) {
            print("VirtualKeyboard: plus background failed: " + e);
        }
    }

    private resolveBgColor(): vec4 {
        if (this.panelBackgroundMaterial) {
            try {
                const c = (this.panelBackgroundMaterial.mainPass as any).baseColor;
                if (c) return new vec4(c.x, c.y, c.z, this.bgColor.w);
            } catch (e) {}
        }
        return this.bgColor;
    }

    private buildKeys() {
        const root = this.getSceneObject();
        for (const section of SECTION_ORDER) {
            const c = this.sectionCenter(section);
            for (let row = 0; row < ROWS; row++) {
                for (let col = 0; col < COLS; col++) {
                    const nx = c.x + (col - (COLS - 1) / 2) * this.colSpacing;
                    const ny = c.y + ((ROWS - 1) / 2 - row) * this.rowSpacing;

                    const obj = global.scene.createSceneObject(
                        "key_" + section + "_" + row + "_" + col);
                    obj.setParent(root);

                    const st = obj.createComponent("Component.ScreenTransform") as ScreenTransform;
                    st.anchors.setCenter(new vec2(nx, ny));
                    st.anchors.setSize(new vec2(0, 0));
                    st.offsets.setSize(new vec2(this.colSpacing, this.rowSpacing));

                    const text = obj.createComponent("Component.Text") as any;
                    text.size = this.keySize;
                    if (this.keyFont) text.font = this.keyFont; // bold font
                    text.horizontalAlignment = HorizontalAlignment.Center;
                    text.verticalAlignment = VerticalAlignment.Center;
                    text.renderOrder = 2;
                    const color = new vec4(this.DIM.x, this.DIM.y, this.DIM.z, this.DIM.w);
                    text.textFill.color = color;
                    // Bold/legible: dark outline behind the glyph (like the title text).
                    if (text.outlineSettings) {
                        text.outlineSettings.enabled = true;
                        text.outlineSettings.size = 0.6;
                        if (text.outlineSettings.fill) {
                            text.outlineSettings.fill.color = new vec4(0, 0, 0, 1);
                        }
                    }

                    this.cells.push({
                        section, row, col, text, color,
                        target: color, flashUntil: 0, hovered: false,
                    });
                }
            }
        }
        print("VirtualKeyboard: built " + this.cells.length + " keys.");
    }

    // Public so the Settings key-swap editor can re-render after mutating LAYOUT.
    public refreshLabels() {
        for (const cell of this.cells) {
            const def = LAYOUT[cell.section][cell.row][cell.col];
            cell.text.text = cellLabel(def, this.shiftedView);
        }
    }

    // --- tap-to-type -------------------------------------------------------
    // Every key gets a collider + SIK Interactable (targeting mode 7 = Direct +
    // Indirect + Poke) so a finger tap, a hand-ray pinch, or the controller
    // cursor all commit the key. The keys only exist while EditorViewRoot is
    // active, which is also the only TYPING-mode view, so taps can't leak into
    // focus-ring navigation.
    private installKeyInteraction() {
        print("VirtualKeyboard: installKeyInteraction (" + this.cells.length + " cells)");
        if (this.cells.length <= COLS) return;
        // The key ScreenTransform rects are anchor-positioned with meaningless
        // offset sizes, so measure the real key pitch from the world distance
        // between adjacent key centers instead.
        const objAt = (i: number) => this.cells[i].text.getSceneObject();
        const p00 = objAt(0).getTransform().getWorldPosition();
        const dx = objAt(1).getTransform().getWorldPosition().distance(p00);
        const dy = objAt(COLS).getTransform().getWorldPosition().distance(p00);
        print("VirtualKeyboard: measured pitch " + dx + " x " + dy);
        if (dx < 0.001 || dy < 0.001) {
            print("VirtualKeyboard: key pitch degenerate (" + dx + "x" + dy + "); no key colliders.");
            return;
        }
        let installed = 0;
        for (const cell of this.cells) {
            try {
                const obj = cell.text.getSceneObject();
                const ws = obj.getTransform().getWorldScale();
                const sx = ws.x > 0.001 ? ws.x : 1;
                const sy = ws.y > 0.001 ? ws.y : 1;
                const collider = obj.createComponent("Physics.ColliderComponent") as any;
                const box = Shape.createBoxShape();
                // 0.95: leave a sliver between neighbouring key colliders.
                box.size = new vec3((dx / sx) * 0.95, (dy / sy) * 0.95, dy / sy);
                collider.shape = box;
                collider.fitVisual = false;
                const inter: any = obj.createComponent(Interactable.getTypeName());
                inter.targetingMode = 7;   // Direct | Indirect | Poke
                inter.onTriggerEnd.add(() => this.tapKey(cell));
                if (inter.onHoverEnter && inter.onHoverEnter.add) {
                    inter.onHoverEnter.add(() => { cell.hovered = true; });
                }
                if (inter.onHoverExit && inter.onHoverExit.add) {
                    inter.onHoverExit.add(() => { cell.hovered = false; });
                }
                installed++;
            } catch (e) {
                print("VirtualKeyboard: key interactable failed: " + e);
            }
        }
        print("VirtualKeyboard: tap-to-type on " + installed + " keys (pitch "
            + dx.toFixed(2) + "x" + dy.toFixed(2) + ").");
    }

    // Synthesize the exact commit packet the firmware would send, so a tapped
    // key drives the same pipeline as a chorded one: onCommit flashes the key,
    // onKeypress types into the document, plays audio, updates stats.
    private tapKey(cell: KeyCell) {
        if (!this.bleKeyboard) return;
        const def = LAYOUT[cell.section][cell.row][cell.col];
        const shifted = this.selection.shiftPending || this.selection.capsLock;
        let payload = 0;
        if (def.action === Action.Insert) {
            const label = shifted ? def.shift : def.base;
            payload = label.charCodeAt(0);
        } else if (def.action === Action.Emoji && def.emoji) {
            payload = def.emoji;
        }
        this.bleKeyboard.injectCommitBytes(new Uint8Array([
            cell.section, cell.row, cell.col, def.action,
            shifted ? 1 : 0, payload, this.tapSeq++ & 0xFF, 0,
        ]));
        // Mirror the firmware's shift bookkeeping, then publish the new state
        // so the shifted-layer labels and the section/row highlight follow.
        if (def.action === Action.Shift) {
            this.selection.shiftPending = !this.selection.shiftPending;
        } else if (def.action === Action.CapsToggle) {
            this.selection.capsLock = !this.selection.capsLock;
        } else {
            this.selection.shiftPending = false;
        }
        const flags =
            (this.selection.shiftPending ? 1 : 0) | (this.selection.capsLock ? 2 : 0);
        this.bleKeyboard.injectStateBytes(new Uint8Array([cell.section, cell.row, flags, 0]));
    }

    // --- event handlers ----------------------------------------------------
    private onSelection(s: SelectionData) {
        const wasShifted = this.shiftedView;
        this.selection = s;
        this.shiftedView = s.shiftPending || s.capsLock;
        if (this.shiftedView !== wasShifted) {
            this.refreshLabels();
        }
    }

    private onCommit(c: CommitData) {
        // Flash the committed cell. Joystick-click Space uses button 0xFF; skip.
        if (c.button >= COLS) return;
        const cell = this.findCell(c.section, c.row, c.button);
        if (cell) {
            cell.flashUntil = getTime() + 0.22;
            cell.color = new vec4(this.FLASH.x, this.FLASH.y, this.FLASH.z, this.FLASH.w);
        }
    }

    private findCell(section: Section, row: number, col: number): KeyCell | null {
        for (const cell of this.cells) {
            if (cell.section === section && cell.row === row && cell.col === col) {
                return cell;
            }
        }
        return null;
    }

    // --- per-frame animation ----------------------------------------------
    private update() {
        const now = getTime();
        const dt = getDeltaTime();
        const k = Math.min(1, dt * 12); // lerp speed

        for (const cell of this.cells) {
            // target color based on current selection
            let target = this.DIM;
            if (cell.section === this.selection.section) {
                if (cell.row === this.selection.row) {
                    const held = (this.selection.heldButtons & (1 << cell.col)) !== 0;
                    target = held ? this.KEY : this.ROW;
                } else {
                    target = this.SECTION;
                }
            }
            // A finger/cursor hovering a key reads like a held button.
            if (cell.hovered) target = this.KEY;
            cell.target = target;

            if (cell.flashUntil > now) {
                // hold the flash color, don't lerp away yet
                continue;
            }
            cell.color = vec4.lerp(cell.color, cell.target, k);
            cell.text.textFill.color = cell.color;
        }
    }

    // --- auto-demo (preview, no hardware) ---------------------------------
    private startDemo() {
        // Spell a short word by navigating section/row then committing a key.
        // Each step: (section, row, button). Resolves to a char via LAYOUT.
        const steps: number[][] = [
            [Section.Top, 1, 3],     // h
            [Section.Top, 2, 0],     // i
            [Section.Bottom, 0, 1],  // Shift (next letter capitalized)
            [Section.Top, 0, 0],     // A
            [Section.Center, 0, 2],  // 0
        ];
        let i = 0;
        const ev = this.createEvent("DelayedCallbackEvent");
        const tick = () => {
            const step = steps[i % steps.length];
            const section = step[0], row = step[1], button = step[2];
            // 1) move selection (highlight section + row)
            const flags =
                (this.selection.shiftPending ? 1 : 0) | (this.selection.capsLock ? 2 : 0);
            this.bleKeyboard.injectStateBytes(new Uint8Array([section, row, flags, 0]));
            // 2) shortly after, commit the key
            const commitEv = this.createEvent("DelayedCallbackEvent");
            commitEv.bind(() => {
                const def = LAYOUT[section][row][button];
                let action = def.action;
                let payload = 0;
                let shifted = this.selection.shiftPending || this.selection.capsLock;
                if (action === Action.Insert) {
                    const label = shifted ? def.shift : def.base;
                    payload = label.charCodeAt(0);
                }
                if (action === Action.Emoji && def.emoji) payload = def.emoji;
                this.bleKeyboard.injectCommitBytes(new Uint8Array(
                    [section, row, button, action, shifted ? 1 : 0, payload, (i & 0xFF), 0]));
                // update local shift/caps as the firmware would
                if (action === Action.Shift) this.selection.shiftPending = !this.selection.shiftPending;
                else if (action === Action.CapsToggle) this.selection.capsLock = !this.selection.capsLock;
                else this.selection.shiftPending = false;
            });
            commitEv.reset(0.5);

            i++;
            ev.reset(1.1);
        };
        ev.bind(tick);
        ev.reset(1.0);
        print("VirtualKeyboard: auto-demo started.");
    }
}
