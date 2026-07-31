// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Popup panel for the Google Drive flows, built at runtime in the Editor view
// (same cloned-material/Image + collider/Interactable technique as the round
// editor buttons). Three modes:
//   - sign-in: explains the phone hand-off and shows a "Sign in with Google"
//     pill (OAuth happens in the Spectacles App — no password fields in-lens).
//   - files:   a pageable list of the user's Drive .txt files; tap one to pick.
//   - status:  a transient message ("Saving…", "Saved to Drive", errors).
// Everything is tappable by finger poke, hand-ray pinch, or controller cursor.

import {DriveFile} from "./GoogleDriveStore"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

const ROWS_PER_PAGE = 4
const ROW_YS = [3.5, -0.5, -4.5, -8.5]

@component
export class GoogleDrivePanel extends BaseScriptComponent {

    @input
    @allowUndefined
    @hint("Parent the panel is built under (the Editor view root)")
    panelParent: SceneObject

    @input
    @allowUndefined
    @hint("Transparent-unlit UI material (e.g. EmojiCool) — cloned for panel images")
    uiTextureMaterial: Material

    @input
    @allowUndefined
    @hint("Pill texture used for the panel background and buttons")
    pillTex: Texture

    @input
    @allowUndefined
    @hint("Font for panel text")
    labelFont: Font

    private root: SceneObject = null
    private titleText: any = null
    private statusText: any = null
    private signInGroup: SceneObject = null
    private rowObjs: SceneObject[] = []
    private rowTexts: any[] = []
    private pageUpObj: SceneObject = null
    private pageDownObj: SceneObject = null
    private pageText: any = null

    private files: DriveFile[] = []
    private pageStart: number = 0
    private mode: string = "hidden"
    private onSignInCb: () => void = null
    private onPickCb: (f: DriveFile) => void = null
    private autoHideEvent: DelayedCallbackEvent = null

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.build())
    }

    private parent(): SceneObject {
        return this.panelParent ? this.panelParent : this.getSceneObject()
    }

    // --- construction -------------------------------------------------------

    private build(): void {
        this.root = global.scene.createSceneObject("DrivePanel")
        this.root.setParent(this.parent())
        this.root.getTransform().setLocalPosition(new vec3(0, 1, 2.5))

        // Background: a stretched pill, drawn above the editor content.
        const bg = global.scene.createSceneObject("bg")
        bg.setParent(this.root)
        bg.getTransform().setLocalScale(new vec3(48, 30, 1))
        this.texImage(bg, this.pillTex, 10)
        // Swallow taps on the backdrop so they can't reach keys/buttons under it.
        this.installHit(bg, () => {}, 1, 1)

        this.titleText = this.makeText(this.root, "Google Drive", 0, 11.5, 24,
            new vec4(1, 1, 1, 1))
        this.statusText = this.makeText(this.root, "", 0, 7.5, 17,
            new vec4(0.85, 0.87, 0.92, 1))

        // Sign-in pill (shown only in sign-in mode).
        this.signInGroup = global.scene.createSceneObject("signin")
        this.signInGroup.setParent(this.root)
        const pillBg = global.scene.createSceneObject("pill")
        pillBg.setParent(this.signInGroup)
        pillBg.getTransform().setLocalPosition(new vec3(0, 0, 0.1))
        pillBg.getTransform().setLocalScale(new vec3(18, 5, 1))
        this.texImage(pillBg, this.pillTex, 11)
        this.makeText(this.signInGroup, "Sign in with Google", 0, 0.2, 20,
            new vec4(1, 1, 1, 1))
        this.installHit(this.signInGroup, () => {
            if (this.onSignInCb) this.onSignInCb()
        }, 18, 5)

        // File rows.
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            const row = global.scene.createSceneObject("row_" + i)
            row.setParent(this.root)
            row.getTransform().setLocalPosition(new vec3(0, ROW_YS[i], 0.1))
            const txt = this.makeText(row, "", 0, 0, 19, new vec4(0.95, 0.96, 1, 1))
            const idx = i
            this.installHit(row, () => this.pickRow(idx), 36, 3.6)
            this.rowObjs.push(row)
            this.rowTexts.push(txt)
        }

        // Paging controls + indicator.
        this.pageUpObj = this.makeTapText(this.root, "▲", 20, 3.5, 22, () => this.page(-1))
        this.pageDownObj = this.makeTapText(this.root, "▼", 20, -8.5, 22, () => this.page(1))
        this.pageText = this.makeText(this.root, "", 20, -2.5, 14,
            new vec4(0.8, 0.82, 0.88, 1))

        // Close button.
        this.makeTapText(this.root, "✕", 22, 12.5, 22, () => this.hide())

        this.root.enabled = false
        this.autoHideEvent = this.createEvent("DelayedCallbackEvent")
        this.autoHideEvent.bind(() => this.hide())
        this.autoHideEvent.enabled = false
        print("GoogleDrivePanel: built.")
    }

    private cancelAutoHide(): void {
        if (this.autoHideEvent) this.autoHideEvent.enabled = false
    }

    private texImage(host: SceneObject, tex: Texture, order: number): void {
        try {
            const img = host.createComponent("Component.Image") as any
            if (this.uiTextureMaterial && tex) {
                const m = this.uiTextureMaterial.clone()
                m.mainPass.baseTex = tex
                img.mainMaterial = m
            }
            img.renderOrder = order
        } catch (e) { print("GoogleDrivePanel: texImage failed: " + e) }
    }

    private makeText(parentObj: SceneObject, str: string, x: number, y: number,
                     size: number, color: vec4): any {
        const obj = global.scene.createSceneObject("txt")
        obj.setParent(parentObj)
        obj.getTransform().setLocalPosition(new vec3(x, y, 0.2))
        try {
            const t = obj.createComponent("Component.Text") as any
            t.text = str
            t.size = size
            if (this.labelFont) t.font = this.labelFont
            t.horizontalAlignment = HorizontalAlignment.Center
            t.verticalAlignment = VerticalAlignment.Center
            t.renderOrder = 12
            t.textFill.color = color
            return t
        } catch (e) {
            print("GoogleDrivePanel: makeText failed: " + e)
            return null
        }
    }

    private makeTapText(parentObj: SceneObject, str: string, x: number, y: number,
                        size: number, cb: () => void): SceneObject {
        const obj = global.scene.createSceneObject("tap_" + str)
        obj.setParent(parentObj)
        obj.getTransform().setLocalPosition(new vec3(x, y, 0.1))
        this.makeText(obj, str, 0, 0, size, new vec4(1, 1, 1, 1))
        this.installHit(obj, cb, 4.5, 4.5)
        return obj
    }

    // Collider + Interactable; mode 7 = Direct | Indirect | Poke, so finger
    // taps work alongside pinch and the controller cursor (same as the keys).
    private installHit(obj: SceneObject, cb: () => void, w: number, h: number): void {
        try {
            const col = obj.createComponent("Physics.ColliderComponent") as any
            const box = Shape.createBoxShape()
            box.size = new vec3(w, h, 3)
            col.shape = box
            col.fitVisual = false
            const inter: any = obj.createComponent(Interactable.getTypeName())
            inter.targetingMode = 7
            inter.onTriggerEnd.add(() => cb())
        } catch (e) { print("GoogleDrivePanel: installHit failed: " + e) }
    }

    // --- modes --------------------------------------------------------------

    /** Sign-in prompt. `onSignIn` fires when the pill is tapped. */
    public showSignIn(message: string, onSignIn: () => void): void {
        if (!this.root) return
        this.cancelAutoHide()
        this.mode = "signin"
        this.onSignInCb = onSignIn
        this.root.enabled = true
        this.titleText.text = "Google Drive"
        this.statusText.text = message
        this.signInGroup.enabled = true
        this.setRowsVisible(false)
    }

    /** Pageable .txt list. `onPick` fires with the tapped file. */
    public showFiles(files: DriveFile[], onPick: (f: DriveFile) => void): void {
        if (!this.root) return
        this.cancelAutoHide()
        this.mode = "files"
        this.files = files
        this.onPickCb = onPick
        this.pageStart = 0
        this.root.enabled = true
        this.titleText.text = "Open from Google Drive"
        this.statusText.text = files.length === 0
            ? "No .txt files found in your Drive"
            : "Tap a document to open it"
        this.signInGroup.enabled = false
        this.setRowsVisible(true)
        this.renderPage()
    }

    /** Transient status message; auto-hides after `autoHideSec` if given. */
    public showStatus(message: string, autoHideSec: number = 0): void {
        if (!this.root) return
        this.cancelAutoHide()
        this.mode = "status"
        this.root.enabled = true
        this.titleText.text = "Google Drive"
        this.statusText.text = message
        this.signInGroup.enabled = false
        this.setRowsVisible(false)
        if (autoHideSec > 0) {
            this.autoHideEvent.enabled = true
            this.autoHideEvent.reset(autoHideSec)
        }
    }

    /** Update the status line without changing mode (progress messages). */
    public setStatus(message: string): void {
        if (this.statusText) this.statusText.text = message
    }

    public hide(): void {
        this.cancelAutoHide()
        this.mode = "hidden"
        if (this.root) this.root.enabled = false
    }

    public isOpen(): boolean {
        return this.mode !== "hidden"
    }

    // --- list internals -----------------------------------------------------

    private setRowsVisible(visible: boolean): void {
        for (const r of this.rowObjs) r.enabled = visible
        const paged = visible && this.files.length > ROWS_PER_PAGE
        if (this.pageUpObj) this.pageUpObj.enabled = paged
        if (this.pageDownObj) this.pageDownObj.enabled = paged
        if (this.pageText) this.pageText.text = ""
    }

    private renderPage(): void {
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            const f = this.files[this.pageStart + i]
            let label = f ? f.name : ""
            if (label.length > 38) label = label.slice(0, 37) + "…"
            this.rowTexts[i].text = label
            this.rowObjs[i].enabled = !!f
        }
        if (this.files.length > ROWS_PER_PAGE && this.pageText) {
            const page = Math.floor(this.pageStart / ROWS_PER_PAGE) + 1
            const pages = Math.ceil(this.files.length / ROWS_PER_PAGE)
            this.pageText.text = page + "/" + pages
        }
    }

    private page(dir: number): void {
        const next = this.pageStart + dir * ROWS_PER_PAGE
        if (next < 0 || next >= this.files.length) return
        this.pageStart = next
        this.renderPage()
    }

    private pickRow(i: number): void {
        if (this.mode !== "files") return
        const f = this.files[this.pageStart + i]
        if (f && this.onPickCb) this.onPickCb(f)
    }
}
