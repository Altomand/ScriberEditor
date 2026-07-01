// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Scriber focus-ring navigation. Each view registers an ordered list of
// focusable UI elements; the joystick moves a yellow highlight between them and
// a button activates the focused one — coexisting with pinch (each focusable
// also gets a SIK Interactable that fires the same activate callback).
// Only active while InputMode == NAVIGATION, so it never fights text entry.

import {BleKeyboard} from "./BleKeyboard"
import {InputModeManager} from "./InputModeManager"
import {Section, Action, SelectionData, CommitData} from "./KeyboardLayout"
import {createCloneRing, tintFocus, installInteractable} from "./HighlightRing"

export interface FocusItem {
    sceneObject: SceneObject
    activate: () => void
    ring?: SceneObject   // optional clone-ring; if absent, tintFocus is used
    onFocus?: () => void // fired when this item becomes focused (e.g. scroll it into view)
}

@component
export class FocusNavigator extends BaseScriptComponent {

    @input
    bleKeyboard: BleKeyboard

    @input
    inputMode: InputModeManager

    @input
    @hint("Seconds between joystick-driven focus moves (debounce)")
    moveCooldown: number = 0.28

    private items: FocusItem[] = []
    private index: number = -1
    private lastSection: Section = Section.Center
    private lastMoveTime: number = 0

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        if (this.bleKeyboard) {
            if (this.bleKeyboard.onSelectionChanged) {
                this.bleKeyboard.onSelectionChanged.add((s: SelectionData) => this.onSelection(s))
            }
            if (this.bleKeyboard.onCommit) {
                this.bleKeyboard.onCommit.add((c: CommitData) => this.onCommit(c))
            }
        }
    }

    /**
     * Replace the focusable set for the current view. Each item gets a clone
     * ring (if its visual supports it) and a pinch Interactable wired to its
     * activate callback. Pass alreadyInteractable=true to skip adding colliders
     * (e.g. SUIK buttons that handle their own pinch).
     */
    public setFocusables(items: FocusItem[], alreadyInteractable: boolean = false): void {
        this.clearVisual()
        // Destroy the previous clone rings so they don't accumulate on cards that
        // persist across refreshes, and so no stale ref survives a list rebuild.
        for (const old of this.items) {
            if (old.ring) { try { old.ring.destroy() } catch (e) {} }
        }
        this.items = items
        for (const item of this.items) {
            if (!item.ring) {
                item.ring = createCloneRing(item.sceneObject) || undefined
            }
            if (!alreadyInteractable) {
                installInteractable(item.sceneObject, item.activate)
            }
        }
        this.index = this.items.length > 0 ? 0 : -1
        this.showFocus()
    }

    public clearFocusables(): void {
        this.clearVisual()
        this.items = []
        this.index = -1
    }

    /** Force focus onto a specific item (e.g. the empty-state card). */
    public focusIndex(i: number): void {
        if (i < 0 || i >= this.items.length) return
        this.setFocusVisual(this.index, false)
        this.index = i
        this.setFocusVisual(this.index, true)
    }

    private clearVisual(): void {
        for (let i = 0; i < this.items.length; i++) this.setFocusVisual(i, false)
    }

    private showFocus(): void {
        if (this.index >= 0) this.setFocusVisual(this.index, true)
    }

    private setFocusVisual(i: number, focused: boolean): void {
        if (i < 0 || i >= this.items.length) return
        const item = this.items[i]
        // NEVER let a destroyed card/ring throw here. This can run inside SIK's
        // trigger dispatch (a tab activate -> composeFocus -> clearVisual), and an
        // uncaught "Object is null" kills SIK's entire update loop — freezing hover
        // AND scroll-drag until the lens resets. (The ring is a child of the card,
        // so it dies when the list rebuilds; our reference goes stale.)
        try {
            if (item.ring) item.ring.enabled = focused
            else tintFocus(item.sceneObject, focused)
        } catch (e) {}
        if (focused && item.onFocus) { try { item.onFocus() } catch (e) {} }
    }

    private move(delta: number): void {
        if (this.items.length === 0) return
        const now = getTime()
        if (now - this.lastMoveTime < this.moveCooldown) return
        this.lastMoveTime = now
        this.setFocusVisual(this.index, false)
        this.index = (this.index + delta + this.items.length) % this.items.length
        this.setFocusVisual(this.index, true)
    }

    private onSelection(s: SelectionData) {
        if (this.inputMode && this.inputMode.isTyping()) return
        // Edge-detect: only act when the section changes away from Center, so a
        // held joystick doesn't race through the list.
        if (s.section === this.lastSection) return
        const prev = this.lastSection
        this.lastSection = s.section
        if (s.section === Section.Center) return
        if (prev !== Section.Center) return  // require a return-to-center between moves
        if (s.section === Section.Top || s.section === Section.Left) this.move(-1)
        else if (s.section === Section.Bottom || s.section === Section.Right) this.move(1)
    }

    private onCommit(c: CommitData) {
        if (this.inputMode && this.inputMode.isTyping()) return
        // Enter key or joystick-click (button 0xFF) activates the focused item.
        if (c.action === Action.Enter || c.button === 0xFF) {
            if (this.index >= 0 && this.index < this.items.length) {
                this.items[this.index].activate()
            }
        }
    }
}
