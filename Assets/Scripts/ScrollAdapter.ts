// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

/**
 * ScrollAdapter — abstraction over the underlying scroll component so
 * ScrollableTextEditor doesn't depend on a specific framework (SIK ScrollView
 * vs SpectaclesUIKit ScrollWindow). Pick an implementation by wiring the
 * matching input in the Inspector; the editor auto-detects which to use.
 *
 * Adding a new backend (e.g., a hand-rolled scroll widget) is a matter of
 * implementing this interface and adding a constructor case in
 * createScrollAdapter().
 */
export interface ScrollAdapter {
    /**
     * Tell the scroll layer that content has grown to N lines of `lineHeight`
     * units each. Implementations may apply an only-grow constraint to avoid
     * scroll-position re-clamping on every keystroke during typing.
     */
    setContentSize(lineCount: number, lineHeight: number): void

    /**
     * Force the scroll layer's content size to exactly match the given line
     * count, including shrinking. Use after a buffer reset (clearBuffer,
     * openBuffer with a smaller saved value) so subsequent scrollToTop /
     * scrollToBottom calls land on the actual content rather than a stale
     * grow-only ceiling.
     */
    resetContentSize(lineCount: number, lineHeight: number): void

    /** Snap the viewport to the bottom of the content. */
    scrollToBottom(): void

    /** Snap the viewport to the top of the content. */
    scrollToTop(): void

    /** Tag for diagnostics. */
    readonly name: string
}

/**
 * Used when no scroll backend is wired. Editor still renders text into the
 * Text component; content just won't scroll if it overflows.
 */
export class NoScrollAdapter implements ScrollAdapter {
    public readonly name = "none"
    public setContentSize(_lineCount: number, _lineHeight: number): void {}
    public resetContentSize(_lineCount: number, _lineHeight: number): void {}
    public scrollToBottom(): void {}
    public scrollToTop(): void {}
}

/**
 * SIK ScrollView adapter (deprecated stack — kept for fallback).
 * SIK requires manual wrapper-anchor manipulation to express content size.
 */
export class SikScrollAdapter implements ScrollAdapter {
    public readonly name = "sik"

    constructor(
        private readonly scrollView: any,
        private readonly contentTransform: ScreenTransform | null
    ) {}

    public setContentSize(lineCount: number, lineHeight: number): void {
        this.applyContentSize(lineCount, lineHeight)
    }

    public resetContentSize(lineCount: number, lineHeight: number): void {
        // SIK's anchor-based sizing already shrinks/grows on each call; no
        // grow-only guard to bypass. Reuse the same path.
        this.applyContentSize(lineCount, lineHeight)
    }

    private applyContentSize(lineCount: number, lineHeight: number): void {
        if (!this.contentTransform) return

        const totalHeight = Math.max(lineCount + 1, 5) * lineHeight
        const anchors = this.contentTransform.anchors
        anchors.bottom = -totalHeight
        anchors.top = 0
        this.contentTransform.anchors = anchors

        if (this.scrollView && this.scrollView.recomputeBoundaries) {
            try {
                this.scrollView.recomputeBoundaries()
            } catch (e) {
                // ScrollView not yet ready (early-init race); safe to skip —
                // a later render will recompute.
            }
        }
    }

    public scrollToBottom(): void {
        if (!this.scrollView) return

        if (this.scrollView.snapToEdges) {
            try {
                this.scrollView.snapToEdges({top: false, bottom: true, left: false, right: false})
                return
            } catch (e) {
                // fall through to scrollBy
            }
        }
        if (this.scrollView.scrollBy) {
            try {
                this.scrollView.scrollBy(new vec2(0, -100))
            } catch (e) {
                // give up silently
            }
        }
    }

    public scrollToTop(): void {
        if (!this.scrollView) return

        if (this.scrollView.snapToEdges) {
            try {
                this.scrollView.snapToEdges({top: true, bottom: false, left: false, right: false})
                return
            } catch (e) {
                // fall through
            }
        }
        if (this.scrollView.scrollBy) {
            try {
                this.scrollView.scrollBy(new vec2(0, 100))
            } catch (e) {
                // give up silently
            }
        }
    }
}

/**
 * SpectaclesUIKit ScrollWindow adapter.
 *
 * Verified against Packages/SpectaclesUIKit.lspkg/.../ScrollWindow.ts:
 *
 * - `scrollDimensions: vec2` — total scrollable area in local-space pixels;
 *   x is window width (we don't change it), y is total content height.
 * - `scrollPositionNormalized: vec2` — y axis ranges -1 (bottom) to 1 (top).
 *   To show the bottom of content, set y = -1.
 * - ScrollWindow re-parents children to an internal `scroller` SceneObject
 *   at runtime, so we do not need to manage a wrapper SceneObject ourselves.
 */
export class UikitScrollAdapter implements ScrollAdapter {
    public readonly name = "uikit"

    constructor(private readonly scrollWindow: any) {}

    public setContentSize(lineCount: number, lineHeight: number): void {
        // Only-grow path used during typing. ScrollWindow re-clamps
        // scrollPosition whenever scrollDimensions changes; updating it on
        // every keystroke causes visible bouncing. Growing only avoids that.
        this.applyContentSize(lineCount, lineHeight, false)
    }

    public resetContentSize(lineCount: number, lineHeight: number): void {
        // Allow-shrink path used on explicit buffer reset (clearBuffer,
        // openBuffer). Without this, after long content followed by a clear,
        // scrollDimensions stays huge while actual content is tiny — the
        // top/bottom snaps then land on empty regions of the stale scroll
        // area, not on the actual text.
        this.applyContentSize(lineCount, lineHeight, true)
    }

    private applyContentSize(lineCount: number, lineHeight: number, allowShrink: boolean): void {
        const w = this.scrollWindow
        if (!w) return

        const calculatedHeight = Math.max(lineCount + 1, 5) * lineHeight

        try {
            const current = w.scrollDimensions
            if (!current || typeof current.x !== "number") return

            // Floor at windowSize so scrollDimensions is never tighter than
            // the visible viewport — that confuses ScrollWindow's positioning.
            const minHeight = (w.windowSize && typeof w.windowSize.y === "number")
                ? w.windowSize.y
                : current.y
            const targetHeight = Math.max(calculatedHeight, minHeight)

            const shouldUpdate = allowShrink
                ? Math.abs(targetHeight - current.y) > 0.5
                : targetHeight > current.y

            if (shouldUpdate) {
                w.scrollDimensions = new vec2(current.x, targetHeight)
            }
        } catch (e) {
            // ScrollWindow not yet initialized; later renders will retry.
        }
    }

    public scrollToBottom(): void {
        const w = this.scrollWindow
        if (!w) return
        try {
            // y = -1 is the bottom edge per ScrollWindow's normalized coords.
            w.scrollPositionNormalized = new vec2(0, -1)
        } catch (e) {
            // ScrollWindow not yet initialized; the next setContent will retry.
        }
    }

    public scrollToTop(): void {
        const w = this.scrollWindow
        if (!w) return
        try {
            // y = 1 is the top edge per ScrollWindow's normalized coords.
            w.scrollPositionNormalized = new vec2(0, 1)
        } catch (e) {
            // ScrollWindow not yet initialized; the next setContent will retry.
        }
    }
}

/**
 * Factory: pick an adapter based on which Inspector inputs are wired.
 *
 * Priority: UIKit ScrollWindow > SIK ScrollView > no-scroll. If both UIKit
 * and SIK are wired, UIKit wins so a half-finished migration leaves the
 * UIKit path active without needing to physically unwire SIK.
 */
export function createScrollAdapter(args: {
    scrollWindow?: any | null
    sikScrollView?: any | null
    sikContentTransform?: ScreenTransform | null
}): ScrollAdapter {
    if (args.scrollWindow) {
        return new UikitScrollAdapter(args.scrollWindow)
    }
    if (args.sikScrollView) {
        return new SikScrollAdapter(args.sikScrollView, args.sikContentTransform || null)
    }
    return new NoScrollAdapter()
}
