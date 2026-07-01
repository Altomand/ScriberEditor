// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Docs tab: lists saved documents as cards in a ScrollWindow. Activating a card
// opens it in the Editor. Empty state shows one yellow-ringed prompt card that
// creates a new document. Supports search filtering.

import Event from "./Event"
import {DocumentManager} from "./DocumentManager"
import {DocumentRecord} from "./DocumentTypes"
import {FocusItem} from "./FocusNavigator"
import {setScrollHeight, findText, findButton} from "./UiUtil"
import {installInteractable, bindActivate} from "./HighlightRing"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

interface CardEntry {
    obj: SceneObject
    text: Text
    record: DocumentRecord | null   // null = empty-state card
    title: string
    matchesFilter?: boolean          // false = hidden by the search query
}

@component
export class DocsListController extends BaseScriptComponent {

    @input
    documentManager: DocumentManager

    @input
    @allowUndefined
    @hint("Optional ScrollWindow that holds the cards (cards still build without it)")
    docsScrollWindow: any

    @input
    @hint("Container SceneObject (scroll content) cards are built under")
    cardContainer: SceneObject

    @input
    @allowUndefined
    @hint("Card prefab from bendConduit (e.g. UserCard). If set, cards use it; else a runtime text card.")
    docCardPrefab: ObjectPrefab

    @input
    @hint("\"mine\" = the user's private docs; \"public\" = All Docs (every user's public docs + cool button)")
    listMode: string = "mine"

    @input
    @allowUndefined
    @hint("Cool-card prefab (CoolTileController) used when listMode = public")
    publicCardPrefab: ObjectPrefab

    @input
    @allowUndefined
    @hint("Transparent-unlit UI material (e.g. EmojiCool) — cloned for the My Docs delete button")
    uiTextureMaterial: Material
    @input
    @allowUndefined
    @hint("Texture: white X delete icon (My Docs cards)")
    deleteIconTex: Texture

    @input
    @allowUndefined
    @hint("Bold font for card titles")
    cardFont: Font

    @input
    @hint("Font size for card titles")
    cardFontSize: number = 30

    @input
    @hint("Vertical spacing between cards (local units)")
    cardSpacing: number = 8

    @input
    @hint("How many cards fit in the panel before the list scrolls (windowed scroll)")
    maxVisibleCards: number = 4

    private cards: CardEntry[] = []
    // Index (within the filtered list) of the top visible card. The list shows a
    // window of maxVisibleCards starting here; the rest are disabled (no overflow).
    // The Scriber focus-ring scrolls the window via FocusItem.onFocus -> ensureVisible.
    private scrollOffset: number = 0

    // Doc-button (row) dimensions; match the DocButton prefab's baked _size so the
    // custom hit area covers the whole row.
    private buttonWidth: number = 34
    private buttonHeight: number = 5

    private onOpenRequestedEvent = new Event<string>()
    private onNewRequestedEvent = new Event<void>()
    private onRebuiltEvent = new Event<void>()
    public onOpenRequested = this.onOpenRequestedEvent.publicApi()
    public onNewRequested = this.onNewRequestedEvent.publicApi()
    public onRebuilt = this.onRebuiltEvent.publicApi()

    // Scroll viewport size (local units). vec2 isn't MCP-settable, so tune here.
    // Height is kept well under the content height so there's real scroll travel
    // (a viewport ~= content height leaves nothing to scroll and elastic-snaps back).
    private scrollWindowWidth: number = 38
    private scrollWindowHeight: number = 24

    private scrollSized: boolean = false

    private lastScrollY: number = -9999

    onAwake() {
        // Auto-refresh whenever a document is saved/deleted.
        this.createEvent("OnStartEvent").bind(() => {
            if (this.documentManager && this.documentManager.onListChanged) {
                this.documentManager.onListChanged.add(() => this.refresh())
            }
        })
        // DEBUG: log the ScrollWindow position whenever it changes, so we can see if
        // a drag actually scrolls the content (vs the cards eating the gesture).
        this.createEvent("UpdateEvent").bind(() => this.debugScroll())
    }

    private debugScroll(): void {
        const sw: any = this.docsScrollWindow
        if (!sw) return
        let y: number = null
        try { if (sw.scrollPosition) y = sw.scrollPosition.y } catch (e) {}
        if (y === null) { try { if (sw.scrollPositionNormalized) y = sw.scrollPositionNormalized.y } catch (e) {} }
        if (y === null) return
        if (Math.abs(y - this.lastScrollY) > 0.02) {
            this.lastScrollY = y
            print("DocsScroll[" + this.listMode + "]: pos=" + y)
        }
    }

    // Size the scroll viewport — but ONLY once the ScrollWindow has initialized
    // (it doesn't until its view is shown, since the editor is the default view).
    // Calling setWindowSize early throws "anchors of undefined". Retry until ready.
    private setupScroll(): void {
        if (this.scrollSized) return
        const sw: any = this.docsScrollWindow
        if (!sw) { print("DocsList[" + this.listMode + "]: no scrollWindow wired"); return }
        if (sw.isInitialized === false) {
            const ev = this.createEvent("DelayedCallbackEvent")
            ev.bind(() => this.setupScroll())
            ev.reset(0.15)
            return
        }
        try {
            const win = sw.windowSize
            const dim = sw.scrollDimensions
            print("DocsList[" + this.listMode + "]: init OK; window=" + (win ? win.x + "x" + win.y : "?")
                + " scrollDim=" + (dim ? dim.x + "x" + dim.y : "?") + " hasSetWin=" + (typeof sw.setWindowSize))
            if (typeof sw.setWindowSize === "function") {
                sw.setWindowSize(new vec2(this.scrollWindowWidth, this.scrollWindowHeight))
                this.scrollSized = true
                print("DocsList[" + this.listMode + "]: setWindowSize -> " + this.scrollWindowWidth + "x" + this.scrollWindowHeight)
            }
        } catch (e) { print("DocsList: setWindowSize failed: " + e) }
    }

    private lastSignature: string = ""

    /** Rebuild the card list from the document store (private or public per listMode). */
    public refresh(): void {
        if (!this.documentManager) return
        this.setupScroll()   // view is now active → size the scroll viewport when ready
        const p = (this.listMode === "public")
            ? this.documentManager.listPublicDocuments()
            : this.documentManager.listDocuments()
        p.then((docs) => {
            // Skip the destroy+rebuild when nothing changed (the common case: just
            // switching tabs). Rebuilding destroys each card's Interactables; if SIK is
            // mid-hover/track on one, it throws "Object is null" every frame and freezes
            // ALL interaction (hover + scroll drag). Only rebuild on real data changes.
            const sig = docs.map((d) => d.id + "|" + (d.updated || 0) + "|" + (d.cool_points || 0)).join(",")
            if (sig === this.lastSignature && this.cards.length > 0) return
            this.lastSignature = sig
            this.rebuild(docs)
        })
    }

    private clearCards(): void {
        const old = this.cards
        this.cards = []
        this.scrollOffset = 0
        // Disable now so SIK drops any hover/trigger on these cards this frame, then
        // destroy a beat later. Destroying an Interactable SIK still tracks throws
        // "Object is null" every frame and freezes all interaction (hover + scroll).
        for (const c of old) { if (c.obj) c.obj.enabled = false }
        const ev = this.createEvent("DelayedCallbackEvent")
        ev.bind(() => { for (const c of old) { if (c.obj) c.obj.destroy() } })
        ev.reset(0.1)
    }

    private rebuild(docs: DocumentRecord[]): void {
        this.clearCards()
        if (!this.cardContainer) {
            print("DocsListController: cardContainer not wired.")
            return
        }
        if (this.listMode === "public") {
            // All Docs: public docs from everyone, each a cool card. No
            // empty-state "+ New Document" card (you don't author from a browse list).
            for (const d of docs) this.addPublicCard(d)
        } else if (docs.length === 0) {
            this.addEmptyMessage("No Documents saved yet")
        } else {
            for (const d of docs) this.addCard(d, d.title || "Untitled", false)
        }
        this.layout()
        this.onRebuiltEvent.invoke()
    }

    // Build a card — from bendConduit's card prefab if wired, else a runtime Text.
    private addCard(record: DocumentRecord | null, title: string, emptyState: boolean): void {
        const activate = () => {
            if (record) this.onOpenRequestedEvent.invoke(record.id)
            else this.onNewRequestedEvent.invoke()
        }
        let obj: SceneObject
        let text: any
        if (this.docCardPrefab) {
            // Card built from a SUIK button prefab (clean materials from the SUIK package).
            obj = this.docCardPrefab.instantiate(this.cardContainer)
            obj.name = record ? ("card_" + record.id) : "card_empty"
            obj.enabled = true   // template button may be disabled in the source
            text = findText(obj)
            if (text) text.text = title
            const btn = findButton(obj)
            if (btn) {
                // SUIK's auto-collider mis-fits when the button is sized far past
                // its default (confirmed empirically: hover/pinch only register on
                // one edge), so once the button has initialized (next frame) we
                // disable it and drive the row with our own centered, full-size
                // hit area.
                // Narrow + shift the open region left so the right side is free for
                // the delete button (same trick as the public cool cards).
                const ev = this.createEvent("DelayedCallbackEvent")
                ev.bind(() => this.installRowInteraction(obj, btn, activate, 25, -4.5))
                ev.reset(0.1)
            } else {
                bindActivate(obj, activate)
            }
        } else {
            // Runtime text card fallback.
            obj = global.scene.createSceneObject(record ? ("card_" + record.id) : "card_empty")
            obj.setParent(this.cardContainer)
            text = obj.createComponent("Component.Text") as any
            text.text = title
            text.size = this.cardFontSize
            if (this.cardFont) text.font = this.cardFont
            try {
                text.horizontalAlignment = HorizontalAlignment.Left
                text.verticalAlignment = VerticalAlignment.Center
                text.horizontalOverflow = HorizontalOverflow.Wrap
            } catch (e) {}
            installInteractable(obj, activate)
        }
        this.styleCard(obj, text, emptyState)
        if (record) this.wireDelete(obj, record)
        this.cards.push({ obj, text, record, title })
    }

    // White round delete (X) button on the right of a My Docs card. Deletes the
    // doc from the user's list AND, since a public doc always has a My Docs entry,
    // from All Docs too (DocumentManager.deleteDocument removes the row entirely).
    private wireDelete(obj: SceneObject, record: DocumentRecord): void {
        try {
            const btnObj = global.scene.createSceneObject("DeleteBtn")
            btnObj.setParent(obj)
            btnObj.getTransform().setLocalPosition(new vec3(13, 0, 0.3))
            btnObj.getTransform().setLocalScale(new vec3(3.2, 3.2, 1))
            const img = btnObj.createComponent("Component.Image") as any
            if (this.uiTextureMaterial && this.deleteIconTex) {
                const m = this.uiTextureMaterial.clone()
                m.mainPass.baseTex = this.deleteIconTex
                img.mainMaterial = m
            }
        } catch (e) { print("DocsList: delete btn failed: " + e) }

        const rowBtn: any = findButton(obj)
        const setHover = (on: boolean) => {
            try { if (rowBtn && rowBtn.setState) rowBtn.setState(on ? "hovered" : "default") } catch (e) {}
        }
        try {
            const hit = global.scene.createSceneObject("DeleteHit")
            hit.setParent(obj)
            hit.getTransform().setLocalPosition(new vec3(13, 0, 0.4))
            const col = hit.createComponent("Physics.ColliderComponent") as any
            const box = Shape.createBoxShape()
            box.size = new vec3(7, 7, 6)
            col.shape = box
            col.fitVisual = false
            const inter: any = hit.createComponent(Interactable.getTypeName())
            inter.onTriggerEnd.add(() => {
                if (this.documentManager) this.documentManager.deleteDocument(record.id)
            })
            if (inter.onHoverEnter && inter.onHoverEnter.add) inter.onHoverEnter.add(() => setHover(true))
            if (inter.onHoverExit && inter.onHoverExit.add) inter.onHoverExit.add(() => setHover(false))
        } catch (e) { print("DocsList: delete hit failed: " + e) }
    }

    // Each card is a real SUIK button (cloned from the working "New Doc"
    // CapsuleButton), so SUIK renders its own capsule visual — no material to
    // break (this is the localjoost data-driven scroll-menu pattern). We only
    // touch the label: wrap long titles and color the empty-state prompt yellow.
    // (Button/material colors can't be set via the editor bridge, but a Text's
    // textFill CAN be set from script, which is why the empty-state goes yellow.)
    private styleCard(obj: SceneObject, text: any, emptyState: boolean): void {
        if (!text) return
        try {
            text.horizontalAlignment = HorizontalAlignment.Center
            text.verticalAlignment = VerticalAlignment.Center
            text.horizontalOverflow = HorizontalOverflow.Wrap
        } catch (e) {}
        try {
            text.textFill.color = emptyState
                ? new vec4(1.0, 0.85, 0.1, 1.0)
                : new vec4(0.95, 0.96, 1.0, 1.0)
        } catch (e) {}
    }

    // Plain, non-interactive centered message (e.g. the My Docs empty state).
    private addEmptyMessage(msg: string): void {
        const obj = global.scene.createSceneObject("empty_msg")
        obj.setParent(this.cardContainer)
        const text = obj.createComponent("Component.Text") as any
        text.text = msg
        try {
            text.size = this.cardFontSize
            if (this.cardFont) text.font = this.cardFont
            text.horizontalAlignment = HorizontalAlignment.Center
            text.verticalAlignment = VerticalAlignment.Center
        } catch (e) {}
        try { text.textFill.color = new vec4(0.8, 0.82, 0.88, 1.0) } catch (e) {}
        this.cards.push({ obj, text, record: null, title: msg })
    }

    // All Docs card (public). The prefab is visual-only — a title row button plus
    // named children "CoolBtn" (the cool button host), "CoolCount" (count text) and
    // "CooledRing" (highlight). We wire it here: the row opens the doc (reusing the
    // proven RowHit interaction), and the cool button toggles the user's cool via
    // documentManager.coolDocument with an optimistic update + rollback on failure.
    private addPublicCard(record: DocumentRecord): void {
        if (!this.publicCardPrefab) {
            print("DocsListController: publicCardPrefab not wired (listMode=public).")
            return
        }
        const obj = this.publicCardPrefab.instantiate(this.cardContainer)
        obj.name = "pubcard_" + record.id
        obj.enabled = true
        this.hideChildByName(obj, "CameraImage")
        this.hideChildByName(obj, "DiagramOverlay")

        const titleText = this.textInChildNamed(obj, "Label") || findText(obj)
        if (titleText) titleText.text = record.title || "Untitled"

        // Row open — reuse the My-Docs RowHit fix (SUIK collider mis-fits when wide).
        const btn = findButton(obj)
        const open = () => this.onOpenRequestedEvent.invoke(record.id)
        if (btn && btn.onTriggerUp && btn.onTriggerUp.add) {
            // Open region covers the card up to where the cool button begins (~x8).
            const ev = this.createEvent("DelayedCallbackEvent")
            ev.bind(() => this.installRowInteraction(obj, btn, open, 25, -4.5))
            ev.reset(0.1)
        } else {
            bindActivate(obj, open)
        }

        this.wireCool(obj, record)
        this.cards.push({ obj, text: titleText, record, title: record.title || "Untitled" })
    }

    // Cool button + count + highlight, wired from the prefab's named children.
    private wireCool(obj: SceneObject, record: DocumentRecord): void {
        const coolBtn = this.childNamed(obj, "CoolBtn")
        const countObj = this.childNamed(obj, "CoolCount")
        const countText = countObj ? findText(countObj) : null
        const ring = this.childNamed(obj, "CooledRing")

        // Lay out the cool button + count INSIDE the card's right side. Runtime
        // transforms DO work (unlike the editor bridge), so position them here.
        if (coolBtn) {
            coolBtn.getTransform().setLocalPosition(new vec3(12, 0, 0.3))
            coolBtn.getTransform().setLocalScale(new vec3(3.5, 3.5, 1))
        }
        if (countObj) countObj.getTransform().setLocalPosition(new vec3(15.5, 0, 0.3))

        let cooled = !!record.user_cooled
        let points = record.cool_points || 0
        const render = () => {
            if (countText) countText.text = String(points)
            if (ring) ring.enabled = cooled
        }
        render()
        const toggle = () => {
            const prevC = cooled, prevP = points
            cooled = !cooled
            points += cooled ? 1 : -1
            render()
            const p: any = this.documentManager.coolDocument(record.id, cooled)
            if (p && typeof p.catch === "function") {
                p.catch(() => { cooled = prevC; points = prevP; render() })
            }
        }

        // Dedicated small, UNSCALED hit area for the cool button — a child of the
        // card root, NOT the 3.5x-scaled CoolBtn (whose local collider ballooned to
        // ~24u and bled into neighbouring cards). Sits in the right gap that the
        // row-open hit (narrowed + shifted left in addPublicCard) leaves open, so
        // taps on the face cool and taps on the title open.
        // Hovering the cool button should still highlight the card, so the right
        // side feels alive too (the row hit ends where this begins).
        const rowBtn: any = findButton(obj)
        const setHover = (on: boolean) => {
            try { if (rowBtn && rowBtn.setState) rowBtn.setState(on ? "hovered" : "default") } catch (e) {}
        }
        try {
            const hit = global.scene.createSceneObject("CoolHit")
            hit.setParent(obj)
            hit.getTransform().setLocalPosition(new vec3(12, 0, 0.4))
            const col = hit.createComponent("Physics.ColliderComponent") as any
            const box = Shape.createBoxShape()
            box.size = new vec3(8, 7, 6)
            col.shape = box
            col.fitVisual = false
            const inter: any = hit.createComponent(Interactable.getTypeName())
            inter.onTriggerEnd.add(() => toggle())
            if (inter.onHoverEnter && inter.onHoverEnter.add) inter.onHoverEnter.add(() => setHover(true))
            if (inter.onHoverExit && inter.onHoverExit.add) inter.onHoverExit.add(() => setHover(false))
        } catch (e) { print("DocsList: cool hit failed: " + e) }
    }

    private childNamed(root: SceneObject, name: string): SceneObject | null {
        for (let i = 0; i < root.getChildrenCount(); i++) {
            const ch = root.getChild(i)
            if (ch.name === name) return ch
            const deep = this.childNamed(ch, name)
            if (deep) return deep
        }
        return null
    }
    private textInChildNamed(root: SceneObject, name: string): any {
        const c = this.childNamed(root, name)
        return c ? findText(c) : null
    }
    private hideChildByName(root: SceneObject, name: string): void {
        const c = this.childNamed(root, name)
        if (c) c.enabled = false
    }

    // EXACTLY bendConduit's pattern (FeedTileController.bindButtons): bind ONLY the
    // SUIK button's onTriggerUp and touch nothing else. Our previous version also
    // resized/repositioned the button's collider — that breaks the button's internal
    // drag-vs-scroll handshake with the ScrollWindow, so the list scrolled once then
    // the button stopped releasing drags until the view was re-entered. Leave the
    // button fully native and the ScrollWindow gets every drag, continuously.
    private installRowInteraction(root: SceneObject, btn: any, activate: () => void, width?: number, centerX?: number): void {
        if (!root) return
        try {
            // Disable SUIK's mis-fit collider (its partial-edge hover stops).
            for (let i = 0; i < root.getChildrenCount(); i++) {
                const ch = root.getChild(i)
                if (ch.name === "Collider") {
                    const c = ch.getComponent("Physics.ColliderComponent") as any
                    if (c) c.enabled = false
                }
            }
            // Disable SUIK's interactable on the root so only ours is live.
            try {
                const suik = root.getComponent(Interactable.getTypeName()) as any
                if (suik) suik.enabled = false
            } catch (e) {}

            // Our own hit area on a dedicated child. width/centerX let public cards
            // shrink + shift the open-region left so it clears the cool button.
            const w = (width !== undefined && width > 0) ? width : this.buttonWidth
            const cx = (centerX !== undefined) ? centerX : 0
            const hit = global.scene.createSceneObject("RowHit")
            hit.setParent(root)
            hit.getTransform().setLocalPosition(new vec3(cx, 0, 0))
            const collider = hit.createComponent("Physics.ColliderComponent") as any
            const box = Shape.createBoxShape()
            box.size = new vec3(w, this.buttonHeight, 4)
            collider.shape = box
            collider.fitVisual = false
            const inter: any = hit.createComponent(Interactable.getTypeName())
            inter.onTriggerEnd.add(() => activate())

            // Restore SUIK's native highlight across the full row: drive the
            // button's visual state directly (StateName is a string enum, and
            // setState updates the visual via onStateChangedEvent independent of
            // SUIK's now-disabled interactable). Also nudge the scale so there's
            // motion feedback even if the style's hover is subtle.
            const t = root.getTransform()
            const base = t.getLocalScale()
            const grown = new vec3(base.x * 1.03, base.y * 1.06, base.z)
            const setState = (s: string) => { try { if (btn && btn.setState) btn.setState(s) } catch (e) {} }
            if (inter.onHoverEnter && inter.onHoverEnter.add) {
                inter.onHoverEnter.add(() => { setState("hovered"); try { t.setLocalScale(grown) } catch (e) {} })
            }
            if (inter.onHoverExit && inter.onHoverExit.add) {
                inter.onHoverExit.add(() => { setState("default"); try { t.setLocalScale(base) } catch (e) {} })
            }
            if (inter.onTriggerStart && inter.onTriggerStart.add) {
                inter.onTriggerStart.add(() => setState("triggered"))
            }
        } catch (e) {
            print("DocsList: installRowInteraction failed: " + e)
            bindActivate(root, activate)
        }
    }

    private matchedCards(): CardEntry[] {
        return this.cards.filter((c) => c.matchesFilter !== false)
    }

    // Lay all matched cards in a column and tell the ScrollWindow the content height.
    // The SpectaclesUIKit ScrollWindow (wired to docsScrollWindow, with CardContainer
    // as its content child) clips + pinch-scrolls the world-space cards — bendConduit's
    // ConversationPanel pattern (cards are setLocalPosition'd, scroll is the ScrollWindow's).
    private layout(): void {
        const matched = this.matchedCards()
        for (const c of this.cards) c.obj.enabled = false
        for (let i = 0; i < matched.length; i++) {
            const c = matched[i]
            c.obj.enabled = true
            const t = c.obj.getTransform()
            const p = t.getLocalPosition()
            t.setLocalPosition(new vec3(p.x, -i * this.cardSpacing, p.z))
        }
        setScrollHeight(this.docsScrollWindow, (matched.length + 1) * this.cardSpacing)
    }

    /** Hide/show cards whose title or body doesn't match the query. */
    public filter(query: string): void {
        const q = (query || "").toLowerCase().trim()
        for (const c of this.cards) {
            if (!c.record) { c.matchesFilter = (q.length === 0); continue }
            const hay = (c.title + " " + c.record.body).toLowerCase()
            c.matchesFilter = q.length === 0 || hay.indexOf(q) !== -1
        }
        this.scrollOffset = 0
        this.layout()
    }

    /**
     * Focus items for the Scriber focus-ring — ALL matched cards (not just the
     * visible window), so navigating onto an off-window card scrolls it into view
     * via onFocus -> ensureVisible.
     */
    public getCardFocusItems(): FocusItem[] {
        const items: FocusItem[] = []
        const matched = this.matchedCards()
        for (let i = 0; i < matched.length; i++) {
            const c = matched[i]
            const record = c.record
            items.push({
                sceneObject: c.obj,
                activate: () => {
                    if (record) this.onOpenRequestedEvent.invoke(record.id)
                    else this.onNewRequestedEvent.invoke()
                },
            })
        }
        return items
    }
}
