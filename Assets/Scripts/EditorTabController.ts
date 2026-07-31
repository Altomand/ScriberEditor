// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Editor tab: the ScrollableTextEditor + VirtualKeyboard, plus two round buttons
// built at runtime in the bottom-left above the keyboard:
//   - New Doc (white document icon) -> opens a two-choice prompt: "Blank Doc"
//     (start a fresh document) and "From Drive" (pick one of the user's Google
//     Drive .txt files in the popup panel and open it).
//   - Save (white save icon) -> opens a three-choice prompt: "All Docs" (save
//     public, shows in My Docs + All Docs), "My Docs" (save private, My Docs
//     only), and "Drive" (upload the doc to Google Drive as a .txt).
//     Picking any reverts to the single Save button.
// The display title is derived from the first content line of the doc (deriveTitle).
// Google flows sign in via AuthKit OAuth (GoogleDriveStore) and talk to the
// user through the GoogleDrivePanel popup.
//
// Icons are textures painted on a cloned transparent-unlit material (uiTextureMaterial,
// e.g. the EmojiCool material) with baseTex swapped per button — the same approach that
// renders the cool face. vec2/3 positions are set at runtime (MCP can't write them).

import {DocumentManager} from "./DocumentManager"
import {ScrollableTextEditor} from "./ScrollableTextEditor"
import {InputModeManager, InputMode} from "./InputModeManager"
import {DocumentRecord, deriveTitle} from "./DocumentTypes"
import {FocusItem} from "./FocusNavigator"
import {bindActivate} from "./HighlightRing"
import {GoogleDriveStore, DriveFile} from "./GoogleDriveStore"
import {GoogleDrivePanel} from "./GoogleDrivePanel"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

@component
export class EditorTabController extends BaseScriptComponent {

    @input documentManager: DocumentManager
    @input editor: ScrollableTextEditor
    @input @allowUndefined inputMode: InputModeManager

    @input @allowUndefined
    @hint("Google Drive store (AuthKit OAuth + Drive REST). Unwired = Drive buttons show a config message.")
    googleDrive: GoogleDriveStore

    @input @allowUndefined
    @hint("Popup panel for Google sign-in / Drive file list / status")
    drivePanel: GoogleDrivePanel

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
    private driveSaveBtn: SceneObject = null
    private blankBtn: SceneObject = null
    private driveOpenBtn: SceneObject = null

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        if (this.documentManager && this.documentManager.onDocChanged) {
            this.documentManager.onDocChanged.add((doc: DocumentRecord) => this.renderDoc(doc))
        }
        this.buildButtons()
        this.exitSaveMode()
        this.exitNewMode()
    }

    private parent(): SceneObject {
        return this.buttonParent ? this.buttonParent : this.getSceneObject()
    }

    // Bottom-left, above the keyboard: Save sits above New Doc; the choice
    // pills replace their button (one in its spot, the rest to the left).
    private buildButtons(): void {
        this.newDocBtn = this.makeIconButton("EdNewDoc", this.docIconTex, -30, -7, () => this.enterNewMode())
        this.saveBtn = this.makeIconButton("EdSave", this.saveIconTex, -30, 1, () => this.enterSaveMode())
        this.publicBtn = this.makePillButton("EdSavePublic", "All Docs", -30, 1, () => this.doSave(true))
        this.privateBtn = this.makePillButton("EdSavePrivate", "My Docs", -43, 1, () => this.doSave(false))
        this.driveSaveBtn = this.makePillButton("EdSaveDrive", "Drive", -56, 1, () => this.doSaveToDrive())
        this.blankBtn = this.makePillButton("EdNewBlank", "Blank Doc", -30, -7, () => { this.exitNewMode(); this.newDoc() })
        this.driveOpenBtn = this.makePillButton("EdNewFromDrive", "From Drive", -43, -7, () => { this.exitNewMode(); this.openFromDrive() })
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

    // --- Save flow: Save -> [All Docs | My Docs | Drive] -> back to Save ---
    private enterSaveMode(): void {
        this.exitNewMode()
        if (this.saveBtn) this.saveBtn.enabled = false
        if (this.publicBtn) this.publicBtn.enabled = true
        if (this.privateBtn) this.privateBtn.enabled = true
        if (this.driveSaveBtn) this.driveSaveBtn.enabled = true
    }
    private exitSaveMode(): void {
        if (this.publicBtn) this.publicBtn.enabled = false
        if (this.privateBtn) this.privateBtn.enabled = false
        if (this.driveSaveBtn) this.driveSaveBtn.enabled = false
        if (this.saveBtn) this.saveBtn.enabled = true
    }
    private doSave(isPublic: boolean): void {
        if (this.documentManager) this.documentManager.saveCurrent(isPublic)
        this.exitSaveMode()
    }

    // --- New Doc flow: New -> [Blank Doc | From Drive] -> back to New ---
    private enterNewMode(): void {
        this.exitSaveMode()
        if (this.newDocBtn) this.newDocBtn.enabled = false
        if (this.blankBtn) this.blankBtn.enabled = true
        if (this.driveOpenBtn) this.driveOpenBtn.enabled = true
    }
    private exitNewMode(): void {
        if (this.blankBtn) this.blankBtn.enabled = false
        if (this.driveOpenBtn) this.driveOpenBtn.enabled = false
        if (this.newDocBtn) this.newDocBtn.enabled = true
    }

    // --- Google Drive flows -------------------------------------------------
    // Both flows share the same shape: config check -> sign-in (popup with the
    // OAuth hand-off to the Spectacles App) -> the actual Drive action.
    private doSaveToDrive(): void {
        this.exitSaveMode()
        this.withDriveAuth("Saving to Drive needs your Google account.", () => this.saveToDrive())
    }

    private openFromDrive(): void {
        this.withDriveAuth("Opening from Drive needs your Google account.", () => this.listDriveFiles())
    }

    private withDriveAuth(why: string, action: () => void): void {
        if (!this.googleDrive || !this.drivePanel) {
            print("EditorTabController: googleDrive/drivePanel not wired.")
            return
        }
        if (!this.googleDrive.isConfigured()) {
            this.drivePanel.showStatus("Set the Google clientId on the GoogleDriveStore component", 5)
            return
        }
        if (this.googleDrive.isSignedIn()) {
            action()
            return
        }
        this.drivePanel.showSignIn(why + "\nSign-in continues in the Spectacles App on your phone.", () => {
            this.drivePanel.setStatus("Waiting for sign-in on your phone…")
            this.googleDrive.signIn()
                .then(() => action())
                .catch((e: any) => this.drivePanel.showStatus("Sign-in failed: " + e, 6))
        })
    }

    private saveToDrive(): void {
        const doc = this.documentManager ? this.documentManager.getCurrentDoc() : null
        if (!doc || doc.body.trim().length === 0) {
            this.drivePanel.showStatus("Nothing to save yet — type something first", 4)
            return
        }
        const title = deriveTitle(doc.body)
        this.drivePanel.showStatus("Saving \"" + title + ".txt\" to Drive…")
        this.googleDrive.saveTextFile(doc.id, title, doc.body).then(() => {
            this.drivePanel.showStatus("Saved \"" + title + ".txt\" to Google Drive", 4)
        }).catch((e: any) => {
            this.drivePanel.showStatus("Drive save failed: " + e, 6)
        })
    }

    private listDriveFiles(): void {
        this.drivePanel.showStatus("Loading your Drive documents…")
        this.googleDrive.listTextFiles().then((files: DriveFile[]) => {
            this.drivePanel.showFiles(files, (f: DriveFile) => this.openDriveFile(f))
        }).catch((e: any) => {
            this.drivePanel.showStatus("Drive list failed: " + e, 6)
        })
    }

    private openDriveFile(f: DriveFile): void {
        this.drivePanel.setStatus("Opening \"" + f.name + "\"…")
        this.googleDrive.downloadTextFile(f.id).then((body: string) => {
            const doc = this.documentManager.openImported(body)
            // Re-saving this doc to Drive updates the same file, not a copy.
            this.googleDrive.rememberFileId(doc.id, f.id)
            this.drivePanel.hide()
        }).catch((e: any) => {
            this.drivePanel.showStatus("Drive open failed: " + e, 6)
        })
    }

    /** Called by the panel when the Editor tab becomes active. */
    public enter(): void {
        if (this.inputMode) this.inputMode.setMode(InputMode.TYPING)
        this.exitSaveMode()
        this.exitNewMode()
        if (this.drivePanel) this.drivePanel.hide()
    }

    public getFocusItems(): FocusItem[] {
        const items: FocusItem[] = []
        if (this.newDocBtn && this.newDocBtn.enabled) items.push({ sceneObject: this.newDocBtn, activate: () => this.enterNewMode() })
        if (this.blankBtn && this.blankBtn.enabled) items.push({ sceneObject: this.blankBtn, activate: () => { this.exitNewMode(); this.newDoc() } })
        if (this.driveOpenBtn && this.driveOpenBtn.enabled) items.push({ sceneObject: this.driveOpenBtn, activate: () => { this.exitNewMode(); this.openFromDrive() } })
        if (this.saveBtn && this.saveBtn.enabled) items.push({ sceneObject: this.saveBtn, activate: () => this.enterSaveMode() })
        if (this.publicBtn && this.publicBtn.enabled) items.push({ sceneObject: this.publicBtn, activate: () => this.doSave(true) })
        if (this.privateBtn && this.privateBtn.enabled) items.push({ sceneObject: this.privateBtn, activate: () => this.doSave(false) })
        if (this.driveSaveBtn && this.driveSaveBtn.enabled) items.push({ sceneObject: this.driveSaveBtn, activate: () => this.doSaveToDrive() })
        return items
    }
}
