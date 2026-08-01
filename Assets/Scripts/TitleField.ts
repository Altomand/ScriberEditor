// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// The document-title field to the right of the editor window. Looks like a
// textbox but is deliberately "inactive" — tapping it never summons the
// system keyboard. Instead a tap selects it (yellow border, bendConduit's
// ChecklistEditController highlight pattern) and the Scriber / plus virtual
// keyboard types into it: JournalController routes keypresses here while
// selected. Enter (or tapping the box again) commits and returns typing to
// the document body.
//
// The title lives on the current DocumentRecord (DocumentManager.setTitle)
// and is what Drive / GitHub / Supabase saves use as the file name. Built at
// runtime under the Editor view root, so it hides with the editor view.
// This right-side area will eventually grow into a Drive/GitHub/Supabase
// file-explorer panel; for now it is just the title.

import {DocumentManager} from "./DocumentManager"
import {DocumentRecord} from "./DocumentTypes"
import {findText} from "./UiUtil"
import {bindActivate} from "./HighlightRing"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

const DEFAULT_TITLE = "Doc Title"

// Match the tab pills: the translucent pill texture as-authored, white text.
const BOX_TINT = new vec4(1.0, 1.0, 1.0, 1.0)
const TEXT_WHITE = new vec4(1.0, 1.0, 1.0, 1.0)
const MAX_TITLE_LEN = 60

@component
export class TitleField extends BaseScriptComponent {

    @input
    @allowUndefined
    @hint("Parent the field is built under (the Editor view root, so it hides with the view)")
    panelParent: SceneObject

    @input
    @allowUndefined
    documentManager: DocumentManager

    @input
    @allowUndefined
    @hint("Transparent-unlit UI material (e.g. EmojiCool) — cloned for the box and border")
    uiTextureMaterial: Material

    @input
    @allowUndefined
    @hint("Pill texture for the box background and the yellow selection border")
    pillTex: Texture

    @input
    @allowUndefined
    @hint("SUIK capsule-button prefab (DocButton) — the box renders as a real UIKit capsule, exactly the tab style")
    pillPrefab: ObjectPrefab


    @input
    @allowUndefined
    @hint("Font for the title text")
    labelFont: Font

    @input
    @hint("Field center X (local units, just right of the editor window)")
    fieldX: number = 25

    @input
    @hint("Field center Y")
    fieldY: number = 10

    @input
    @hint("Field width (8x3 = the tab pill size)")
    fieldW: number = 8

    @input
    @hint("Field height")
    fieldH: number = 3

    @input
    @allowUndefined
    @hint("Tapping this object (the editor scroll area) deselects the title field, returning typing to the body")
    deselectTapArea: SceneObject

    private root: SceneObject = null
    private dot: SceneObject = null
    private text: any = null
    private title: string = ""
    private selected: boolean = false

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.build()
        // No document exists until the first keypress / New Doc, so fall back
        // to the default title instead of rendering an empty box.
        this.title = DEFAULT_TITLE
        if (this.documentManager && this.documentManager.onDocChanged) {
            this.documentManager.onDocChanged.add((doc: DocumentRecord) => {
                this.title = doc.title || ""
                this.deselect()
                this.render()
            })
            const doc = this.documentManager.getCurrentDoc()
            if (doc) this.title = doc.title || ""
        }
        this.render()
    }

    private parent(): SceneObject {
        return this.panelParent ? this.panelParent : this.getSceneObject()
    }

    private build(): void {
        this.root = global.scene.createSceneObject("TitleField")
        this.root.setParent(this.parent())
        this.root.getTransform().setLocalPosition(new vec3(this.fieldX, this.fieldY, 0.3))

        // Selection indicator: the same white dot the selected tab shows —
        // a "●" Text child below the pill (copied from the tabs'
        // SelectedVisual: 48pt white at ~0.7 units under the button edge).
        this.dot = global.scene.createSceneObject("SelectedVisual")
        this.dot.setParent(this.root)
        this.dot.getTransform().setLocalPosition(
            new vec3(0, -(this.fieldH / 2 + 0.7), 0.2))
        try {
            const t = this.dot.createComponent("Component.Text") as any
            t.text = "●"
            t.size = 48
            t.horizontalAlignment = HorizontalAlignment.Center
            t.verticalAlignment = VerticalAlignment.Center
            t.renderOrder = 12
            t.textFill.color = new vec4(1, 1, 1, 1)
        } catch (e) { print("TitleField: dot failed: " + e) }
        this.dot.enabled = false

        if (this.pillPrefab) {
            // Real UIKit CapsuleButton (same component as the tabs): its own
            // capsule visual, label styling, and pinch handling.
            const btn = this.pillPrefab.instantiate(this.root)
            btn.name = "box"
            btn.enabled = true
            this.sizeCapsule(btn, this.fieldW, this.fieldH)
            this.text = findText(btn)
            if (this.text) {
                // Same label size as the tab buttons.
                try { this.text.size = 28 } catch (e) {}
            }
            bindActivate(btn, () => this.toggle())
        } else {
            const box = global.scene.createSceneObject("box")
            box.setParent(this.root)
            box.getTransform().setLocalScale(new vec3(this.fieldW, this.fieldH, 1))
            this.pillImage(box, BOX_TINT)

            const txtObj = global.scene.createSceneObject("label")
            txtObj.setParent(this.root)
            txtObj.getTransform().setLocalPosition(new vec3(0, 0.1, 0.2))
            try {
                this.text = txtObj.createComponent("Component.Text") as any
                this.text.size = 22
                if (this.labelFont) this.text.font = this.labelFont
                this.text.horizontalAlignment = HorizontalAlignment.Center
                this.text.verticalAlignment = VerticalAlignment.Center
                this.text.renderOrder = 12
                this.text.textFill.color = TEXT_WHITE
            } catch (e) { print("TitleField: text failed: " + e) }

            // Tap toggles selection; poke/pinch/cursor all work (mode 7).
            try {
                const col = this.root.createComponent("Physics.ColliderComponent") as any
                const shape = Shape.createBoxShape()
                shape.size = new vec3(this.fieldW, this.fieldH, 3)
                col.shape = shape
                col.fitVisual = false
                const inter: any = this.root.createComponent(Interactable.getTypeName())
                inter.targetingMode = 7
                inter.onTriggerEnd.add(() => this.toggle())
            } catch (e) { print("TitleField: interactable failed: " + e) }
        }

        // Tapping the editor area returns typing to the body. isScrollable so
        // the interactable doesn't swallow the ScrollWindow's drag gesture.
        if (this.deselectTapArea) {
            try {
                const col = this.deselectTapArea.createComponent("Physics.ColliderComponent") as any
                const shape = Shape.createBoxShape()
                shape.size = new vec3(32, 30, 2)
                col.shape = shape
                col.fitVisual = false
                const inter: any = this.deselectTapArea.createComponent(Interactable.getTypeName())
                inter.targetingMode = 7
                inter.isScrollable = true
                inter.onTriggerEnd.add(() => this.deselect())
            } catch (e) { print("TitleField: deselect area failed: " + e) }
        }

        print("TitleField: built.")
    }

    private pillImage(host: SceneObject, tint: vec4): void {
        try {
            const img = host.createComponent("Component.Image") as any
            const tex = this.pillTex
            if (this.uiTextureMaterial && tex) {
                const m = this.uiTextureMaterial.clone()
                m.mainPass.baseTex = tex
                try { m.mainPass.baseColor = tint } catch (e) {}
                img.mainMaterial = m
            }
            img.renderOrder = 11
        } catch (e) { print("TitleField: pillImage failed: " + e) }
    }

    // --- selection ----------------------------------------------------------

    public isSelected(): boolean {
        return this.selected
    }

    private toggle(): void {
        this.selected ? this.deselect() : this.select()
    }

    private select(): void {
        this.selected = true
        if (this.dot) this.dot.enabled = true
        this.render()
    }

    public deselect(): void {
        if (!this.selected) return
        this.selected = false
        if (this.dot) this.dot.enabled = false
        this.commit()
        this.render()
    }

    private commit(): void {
        const t = this.title.trim()
        if (this.documentManager) {
            this.documentManager.setTitle(t.length > 0 ? t : DEFAULT_TITLE)
        }
        if (t.length === 0) this.title = DEFAULT_TITLE
    }

    // Resize a UIKit button and force the pill shape (cornerRadius = h/2,
    // exactly what CapsuleButton does). The visual only exists once the
    // button has initialized, so poll briefly until it does.
    private sizeCapsule(obj: SceneObject, w: number, h: number): void {
        if (!obj) return
        let tries = 0
        const apply = (): boolean => {
            let shaped = false
            const scripts = obj.getComponents("Component.ScriptComponent")
            for (let i = 0; i < scripts.length; i++) {
                const s = scripts[i] as any
                if (s && s.size && typeof s.size.x === "number") {
                    try { s.size = new vec3(w, h, 1) } catch (e) {}
                    try {
                        const v = s.visual || s._visual
                        if (v && v.cornerRadius !== undefined) {
                            v.cornerRadius = h * 0.5
                            shaped = true
                        }
                    } catch (e) {}
                }
            }
            return shaped
        }
        const tick = () => {
            if (apply()) {
                print("TitleField: pill shaped")
                return
            }
            if (tries++ > 40) return
            const ev = this.createEvent("DelayedCallbackEvent")
            ev.bind(tick)
            ev.reset(0.25)
        }
        tick()
    }

    // --- typing (routed here by JournalController while selected) -----------

    public applyKey(key: string): void {
        if (key === "BACKSPACE") {
            if (this.title.length > 0) this.title = this.title.slice(0, -1)
        } else if (key === "\n") {
            this.deselect()   // Enter commits and returns typing to the body
            return
        } else if (key === "ESC" || key === "\t" || key.indexOf("[0x") === 0) {
            return
        } else if (this.title.length < MAX_TITLE_LEN) {
            this.title += key
        }
        if (this.documentManager) this.documentManager.setTitle(this.title)
        this.render()
    }

    private render(): void {
        if (!this.text) return
        let shown = this.title
        if (shown.length > 10) shown = "…" + shown.slice(shown.length - 9)
        this.text.text = this.selected ? shown + "▏" : shown
    }
}
