// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

import {ScrollAdapter, createScrollAdapter} from "./ScrollAdapter"

/**
 * ScrollableTextEditor — A view component that renders text inside a
 * scrollable region (SIK ScrollView or SpectaclesUIKit ScrollWindow), with
 * a blinking cursor and auto-scroll.
 *
 * The scroll backend is selected automatically based on which input is
 * wired in the Inspector (see ScrollAdapter.ts). Wire `scrollWindow` for
 * the UIKit path, or `scrollView` + `scrollContentTransform` for the legacy
 * SIK path. Wire neither for a no-scroll fallback that just renders text.
 *
 * Source of truth lives in JournalController; this component only displays
 * whatever string it is told to display via setContent().
 *
 * Scene setup (UIKit, target):
 *   Frame
 *     -> ScrollWindow
 *         -> EditorText (Text component)
 *
 * Scene setup (SIK, legacy):
 *   ContainerFrame
 *     -> ScrollView
 *         -> ScrollContent (ScreenTransform)
 *             -> EditorText (Text component)
 */
@component
export class ScrollableTextEditor extends BaseScriptComponent {

    @input
    @hint("The Text component that displays typed content")
    editorText: Text

    @input
    @allowUndefined
    @hint("UIKit ScrollWindow component (preferred). Wire this OR the SIK pair below.")
    scrollWindow: any

    @input
    @allowUndefined
    @hint("LEGACY: SIK ScrollView component. Used only if scrollWindow is not wired.")
    scrollView: any

    @input
    @allowUndefined
    @hint("LEGACY: ScreenTransform of the SIK scroll content wrapper. Used only with scrollView.")
    scrollContentTransform: ScreenTransform

    @input
    @hint("Line height in local units for scroll calculation (SIK path only)")
    lineHeight: number = 1.5

    @input
    @hint("Max characters per line before wrapping")
    maxLineWidth: number = 45

    @input
    @hint("Lower the editor text's top edge by this many units so the first line starts below the tab bar")
    topInset: number = 3

    @input
    @allowUndefined
    @hint("Bold font for the editor text (e.g. Poppins-Bold) — waveguide legibility")
    boldFont: Font

    @input
    @hint("Cursor character when visible. Common: █ (block), ▮ (filled rect), | (line), _ (underscore)")
    cursorChar: string = "█"

    @input
    @hint("Cursor character when blinked off. MUST be same rendered width as cursorChar to avoid wrap-bounce. Try ▒ or ░ for a pulsing block cursor; ▯ for hollow-rect blink; or '' (empty) to keep cursor solid (no blink).")
    cursorOffChar: string = "▒"

    @input
    @hint("Cursor blink interval in seconds")
    cursorBlinkInterval: number = 0.5

    @input
    @hint("Visible-only hint shown between content and the cursor on a fresh / cleared buffer. Disappears as soon as the user types anything (controller calls setHint(false) on every keypress). NOT saved to the buffer. Empty string to disable.")
    emptyHint: string = "  start typing"

    @input
    @hint("DEBUG: fill the editor with a checker grid so layout can be inspected in Preview without BLE. Ignores setContent() while on.")
    debugGrid: boolean = false

    @input
    @hint("DEBUG: characters per row in the grid")
    debugGridWidth: number = 50

    @input
    @hint("DEBUG: number of rows in the grid")
    debugGridRows: number = 40

    private content: string = ""
    private cursorVisible: boolean = true
    private cursorBlinkEvent: DelayedCallbackEvent
    private deferredScrollEvent: DelayedCallbackEvent
    private adapter: ScrollAdapter
    private currentScrollTarget: "top" | "bottom" | "none" = "bottom"
    private hintVisible: boolean = true

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.adapter = createScrollAdapter({
            scrollWindow: this.scrollWindow,
            sikScrollView: this.scrollView,
            sikContentTransform: this.scrollContentTransform,
        })
        print("ScrollableTextEditor: scroll adapter = " + this.adapter.name)
        this.applyTopInset()
        this.applyBoldStyle()

        if (this.debugGrid) {
            this.content = this.buildDebugGrid()
            this.cursorVisible = false
            this.renderText()
            return
        }

        this.cursorBlinkEvent = this.createEvent("DelayedCallbackEvent")
        this.cursorBlinkEvent.bind(() => {
            this.cursorVisible = !this.cursorVisible
            this.renderText()
            this.cursorBlinkEvent.reset(this.cursorBlinkInterval)
        })
        this.cursorBlinkEvent.reset(this.cursorBlinkInterval)

        // Deferred scroll lands after ScrollWindow has finished its own
        // size/layout pass following a setContent. Important for the
        // initial entry-load case where an immediate scroll can fire
        // before ScrollWindow's content height has caught up. Uses the
        // currentScrollTarget so the deferred snap matches the requested
        // direction (e.g., "top" after a clearBuffer).
        this.deferredScrollEvent = this.createEvent("DelayedCallbackEvent")
        this.deferredScrollEvent.bind(() => this.applyScrollTarget())

        this.renderText()
    }

    // Pull ONLY the editor Text's rect top down so the first line starts
    // below the tab bar. The ScrollWindow viewport is left alone — resizing
    // and shifting it also moves the scroller, so the offsets compound and
    // the text ends up much lower than the inset (the "too low" bug).
    private topInsetApplied: boolean = false
    private applyTopInset(): void {
        const inset = (typeof this.topInset === "number") ? this.topInset : 3
        if (this.topInsetApplied || inset <= 0 || !this.editorText) return
        try {
            const tst = this.editorText.getSceneObject()
                .getComponent("Component.ScreenTransform") as any
            if (!tst) return
            const a = tst.anchors
            a.top = a.top - inset
            tst.anchors = a
            this.topInsetApplied = true
            print("ScrollableTextEditor: applied top inset " + inset)
        } catch (e) {
            print("ScrollableTextEditor: top inset failed: " + e)
        }
    }

    // Bold font + dark outline behind the glyphs: the Spectacles waveguide
    // washes out thin/dim text, so give the editor the same treatment as the
    // virtual keyboard labels.
    private applyBoldStyle(): void {
        if (!this.editorText) return
        try {
            const t: any = this.editorText
            if (this.boldFont) t.font = this.boldFont
            if (t.outlineSettings) {
                t.outlineSettings.enabled = true
                t.outlineSettings.size = 0.5
                if (t.outlineSettings.fill) {
                    t.outlineSettings.fill.color = new vec4(0, 0, 0, 1)
                }
            }
        } catch (e) {
            print("ScrollableTextEditor: bold style failed: " + e)
        }
    }

    /**
     * Update the displayed text and snap the scroll position.
     *
     * @param text Content to render (without the cursor character).
     * @param scrollTo Where to land the viewport. "bottom" (default) for
     *   the typewriter case where the user is appending at the end. "top"
     *   for a fresh / cleared buffer where the heading + cursor fit in
     *   one screen and we want to show them from the top. "none" to leave
     *   scroll position untouched.
     * @param resetSize If true, force the underlying scroll layer's content
     *   size to exactly match the new content (allowing shrink). Use on
     *   buffer-replacement events (clear, initial open). Default false
     *   keeps the only-grow optimization that prevents typing-time bounce.
     */
    public setContent(text: string, scrollTo: "top" | "bottom" | "none" = "bottom", resetSize: boolean = false): void {
        if (this.debugGrid) return
        this.content = text || ""
        this.cursorVisible = true
        if (resetSize) {
            if (this.adapter) {
                this.adapter.resetContentSize(this.getWrappedLineCount(), this.lineHeight)
            }
        } else {
            this.updateContentSize()
        }
        this.renderText()
        this.currentScrollTarget = scrollTo
        if (this.adapter) {
            this.applyScrollTarget()
            // Re-snap after layout has settled — covers the initial entry
            // load race and any other case where the scroll backend needs
            // a frame to update its internal content size.
            if (this.deferredScrollEvent) this.deferredScrollEvent.reset(0.1)
        }
    }

    public getContent(): string {
        return this.content
    }

    /**
     * Show or hide the "start typing" hint. Controller calls setHint(true)
     * when opening a fresh / cleared buffer, and setHint(false) on every
     * keypress so the hint disappears as soon as the user starts typing.
     */
    public setHint(visible: boolean): void {
        if (this.hintVisible === visible) return
        this.hintVisible = visible
        this.renderText()
    }

    private applyScrollTarget(): void {
        if (!this.adapter) return
        if (this.currentScrollTarget === "top") {
            this.adapter.scrollToTop()
        } else if (this.currentScrollTarget === "bottom") {
            this.adapter.scrollToBottom()
        }
        // "none" leaves scroll position alone
    }

    private renderText() {
        if (!this.editorText) return

        const cursor = this.cursorVisible ? this.cursorChar : this.cursorOffChar
        const showHint = this.hintVisible && this.emptyHint && this.emptyHint.length > 0

        // Hint sits between content and the cursor so the cursor remains
        // the typing target (rightmost glyph). Not part of this.content,
        // so it's never persisted. Visibility is controlled explicitly via
        // setHint(visible) — the controller flips it to false on first
        // keypress so the hint disappears as soon as typing starts.
        const displayed = showHint
            ? this.content + this.emptyHint + cursor
            : this.content + cursor

        this.editorText.text = displayed
    }

    private updateContentSize() {
        if (this.adapter && !this.debugGrid) {
            this.adapter.setContentSize(this.getWrappedLineCount(), this.lineHeight)
        }
    }

    private getWrappedLineCount(): number {
        if (this.content.length === 0) return 1

        let count = 0
        const rawLines = this.content.split("\n")

        for (const rawLine of rawLines) {
            if (rawLine.length === 0) {
                count++
                continue
            }
            count += Math.ceil(rawLine.length / this.maxLineWidth)
        }

        return count
    }

    private buildDebugGrid(): string {
        const w = Math.max(10, Math.floor(this.debugGridWidth))
        const rows = Math.max(2, Math.floor(this.debugGridRows))

        const lines: string[] = []

        // Column tens-ruler: "0         1         2         3..."
        let tens = ""
        for (let i = 0; i < w; i++) {
            tens += (i % 10 === 0) ? String(Math.floor(i / 10) % 10) : " "
        }
        lines.push(tens)

        // Column ones-ruler: "0123456789012345..."
        let ones = ""
        for (let i = 0; i < w; i++) {
            ones += String(i % 10)
        }
        lines.push(ones)

        // Body: alternating checker rows, each prefixed with a 2-digit row number.
        // Uses ASCII chars (#, .) so layout math stays width-stable across fonts.
        for (let r = 1; r <= rows; r++) {
            const prefix = (r < 10 ? "0" + r : String(r)) + " "
            const innerW = Math.max(0, w - prefix.length)
            let row = ""
            const rowEven = (r % 2 === 0)
            for (let i = 0; i < innerW; i++) {
                const cellEven = (i % 2 === 0)
                row += (rowEven === cellEven) ? "#" : "."
            }
            lines.push(prefix + row)
        }

        return lines.join("\n")
    }
}
