// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Editor tab: the ScrollableTextEditor + VirtualKeyboard, plus two round buttons
// built at runtime in the bottom-left above the keyboard:
//   - New Doc (white document icon) -> starts a new blank document.
//   - Save (white save icon) -> opens a two-choice prompt: "All Docs" (save
//     public, shows in My Docs + All Docs) and "My Docs" (save private, My Docs
//     only). Picking either saves and reverts to the single Save button.
// The display title is derived from the first content line of the doc (deriveTitle).
//
// Icons are textures painted on a cloned transparent-unlit material (uiTextureMaterial,
// e.g. the EmojiCool material) with baseTex swapped per button — the same approach that
// renders the cool face. vec2/3 positions are set at runtime (MCP can't write them).

import {DocumentManager} from "./DocumentManager"
import {ScrollableTextEditor} from "./ScrollableTextEditor"
import {InputModeManager, InputMode} from "./InputModeManager"
import {DocumentRecord} from "./DocumentTypes"
import {FocusItem} from "./FocusNavigator"
import {bindActivate} from "./HighlightRing"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

@component
export class EditorTabController extends BaseScriptComponent {

    @input documentManager: DocumentManager
    @input editor: ScrollableTextEditor
    @input @allowUndefined inputMode: InputModeManager

    @input @allowUndefined
    @hint("Parent the round buttons are built under (the Editor view root)")
    buttonParent: SceneObject

    @input @allowUndefined
    @hint("Any transparent-unlit UI material (e.g. the EmojiCool material) — cloned per button, baseTex swapped")
    uiTextureMaterial: Material
    @input @allowUndefined @hint("Texture: white document icon (New Doc button)")
    docIconTex: Texture
    @input @allowUndefined @hint("Texture: white save icon (Save button)")
    saveIconTex: Texture
    @input @allowUndefined @hint("Texture: pill background for the All Docs / My Docs choice buttons")
    pillTex: Texture
    @input @allowUndefined @hint("Font for the choice button labels")
    labelFont: Font

    private newDocBtn: SceneObject = null
    private saveBtn: SceneObject = null
    private publicBtn: SceneObject = null
    private privateBtn: SceneObject = null

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        if (this.documentManager && this.documentManager.onDocChanged) {
            this.documentManager.onDocChanged.add((doc: DocumentRecord) => this.renderDoc(doc))
        }
        this.buildButtons()
        this.exitSaveMode()
    }

    private parent(): SceneObject {
        return this.buttonParent ? this.buttonParent : this.getSceneObject()
    }

    // Bottom-left, above the keyboard: Save sits above New Doc; the two save-choice
    // buttons replace Save (one in its spot, one to the left). Tune via screenshot.
    private buildButtons(): void {
        this.newDocBtn = this.makeIconButton("EdNewDoc", this.docIconTex, -30, -7, () => this.newDoc())
        this.saveBtn = this.makeIconButton("EdSave", this.saveIconTex, -30, 1, () => this.enterSaveMode())
        this.publicBtn = this.makePillButton("EdSavePublic", "All Docs", -30, 1, () => this.doSave(true))
        this.privateBtn = this.makePillButton("EdSavePrivate", "My Docs", -43, 1, () => this.doSave(false))
    }

    // An Image showing `tex` via a cloned copy of uiTextureMaterial (baseTex swapped).
    private texImage(host: SceneObject, tex: Texture): void {
        try {
            const img = host.createComponent("Component.Image") as any
            if (this.uiTextureMaterial && tex) {
                const m = this.uiTextureMaterial.clone()
                m.mainPass.baseTex = tex
                img.mainMaterial = m
            }
        } catch (e) { print("EditorTabController: texImage failed: " + e) }
    }

    private makeIconButton(name: string, tex: Texture, x: number, y: number, cb: () => void): SceneObject {
        const obj = global.scene.createSceneObject(name)
        obj.setParent(this.parent())
        obj.getTransform().setLocalPosition(new vec3(x, y, 0.3))
        obj.getTransform().setLocalScale(new vec3(5, 5, 1))
        this.texImage(obj, tex)
        this.installHit(obj, cb, 1.5, 1.5)   // collider lives in the 5x-scaled local space
        return obj
    }

    private makePillButton(name: string, label: string, x: number, y: number, cb: () => void): SceneObject {
        const obj = global.scene.createSceneObject(name)
        obj.setParent(this.parent())
        obj.getTransform().setLocalPosition(new vec3(x, y, 0.3))
        const bg = global.scene.createSceneObject("bg")
        bg.setParent(obj)
        bg.getTransform().setLocalScale(new vec3(12, 4.5, 1))
        this.texImage(bg, this.pillTex)
        try {
            const t = obj.createComponent("Component.Text") as any
            t.text = label
            t.size = 22
            if (this.labelFont) t.font = this.labelFont
            t.horizontalAlignment = HorizontalAlignment.Center
            t.verticalAlignment = VerticalAlignment.Center
        } catch (e) {}
        this.installHit(obj, cb, 12, 4.5)
        return obj
    }

    private installHit(obj: SceneObject, cb: () => void, w: number, h: number): void {
        try {
            const col = obj.createComponent("Physics.ColliderComponent") as any
            const box = Shape.createBoxShape()
            box.size = new vec3(w, h, 4)
            col.shape = box
            col.fitVisual = false
            const inter: any = obj.createComponent(Interactable.getTypeName())
            inter.onTriggerEnd.add(() => cb())
        } catch (e) { bindActivate(obj, cb) }
    }

    private renderDoc(doc: DocumentRecord) {
        if (!this.editor) return
        this.editor.setHint(doc.body.length === 0)
        this.editor.setContent(doc.body, "bottom", true)
    }

    private newDoc() {
        if (this.documentManager) this.documentManager.newDocument()
    }

    // --- Save flow: Save -> [All Docs | My Docs] -> back to Save ---
    private enterSaveMode(): void {
        if (this.saveBtn) this.saveBtn.enabled = false
        if (this.publicBtn) this.publicBtn.enabled = true
        if (this.privateBtn) this.privateBtn.enabled = true
    }
    private exitSaveMode(): void {
        if (this.publicBtn) this.publicBtn.enabled = false
        if (this.privateBtn) this.privateBtn.enabled = false
        if (this.saveBtn) this.saveBtn.enabled = true
    }
    private doSave(isPublic: boolean): void {
        if (this.documentManager) this.documentManager.saveCurrent(isPublic)
        this.exitSaveMode()
    }

    /** Called by the panel when the Editor tab becomes active. */
    public enter(): void {
        if (this.inputMode) this.inputMode.setMode(InputMode.TYPING)
        this.exitSaveMode()
    }

    public getFocusItems(): FocusItem[] {
        const items: FocusItem[] = []
        if (this.newDocBtn) items.push({ sceneObject: this.newDocBtn, activate: () => this.newDoc() })
        if (this.saveBtn && this.saveBtn.enabled) items.push({ sceneObject: this.saveBtn, activate: () => this.enterSaveMode() })
        if (this.publicBtn && this.publicBtn.enabled) items.push({ sceneObject: this.publicBtn, activate: () => this.doSave(true) })
        if (this.privateBtn && this.privateBtn.enabled) items.push({ sceneObject: this.privateBtn, activate: () => this.doSave(false) })
        return items
    }
}
