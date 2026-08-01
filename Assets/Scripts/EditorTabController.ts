// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Editor tab: the ScrollableTextEditor + VirtualKeyboard, plus two round buttons
// built at runtime in the bottom-left above the keyboard:
//   - New Doc (white document icon) -> opens a three-choice prompt: "Blank
//     Doc" (start fresh), a Drive icon (open one of the user's Google Drive
//     .txt files), and a GitHub icon (open a .txt from the configured repo).
//   - Save (white save icon) -> opens a four-choice prompt: "All Docs" (save
//     public), "My Docs" (save private), a Drive icon (upload as .txt to
//     Google Drive), and a GitHub icon (commit as .txt to the repo).
//     Picking any reverts to the single Save button.
// The display title is derived from the first content line of the doc (deriveTitle).
// Google signs in via AuthKit OAuth (GoogleDriveStore); GitHub uses the OAuth
// device flow (GitHubStore); both talk to the user through the GoogleDrivePanel
// popup (sign-in prompt, pageable file list, status).
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
import {findText} from "./UiUtil"
import {GoogleDriveStore, DriveFile} from "./GoogleDriveStore"
import {GitHubStore} from "./GitHubStore"
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
    @hint("GitHub store (device-flow OAuth + repo contents). Unwired = GitHub buttons show a config message.")
    github: GitHubStore

    @input @allowUndefined
    @hint("Popup panel shared by the Drive and GitHub flows")
    drivePanel: GoogleDrivePanel

    @input @allowUndefined @hint("Texture: Google Drive icon (Drive save/open buttons)")
    driveIconTex: Texture
    @input @allowUndefined @hint("Texture: GitHub mark icon (GitHub save/open buttons)")
    githubIconTex: Texture

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
    @input @allowUndefined @hint("SUIK capsule-button prefab (DocButton) — choice pills render as real UIKit capsules, exactly the tab style")
    pillPrefab: ObjectPrefab
    @input @allowUndefined @hint("Font for the choice button labels")
    labelFont: Font

    private newDocBtn: SceneObject = null
    private saveBtn: SceneObject = null
    private publicBtn: SceneObject = null
    private privateBtn: SceneObject = null
    private driveSaveBtn: SceneObject = null
    private githubSaveBtn: SceneObject = null
    private blankBtn: SceneObject = null
    private driveOpenBtn: SceneObject = null
    private githubOpenBtn: SceneObject = null

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
    // pills/icons replace their button (one in its spot, the rest to the left).
    // Drive and GitHub use brand-icon buttons instead of text pills.
    private buildButtons(): void {
        this.newDocBtn = this.makeIconButton("EdNewDoc", this.docIconTex, -30, -7, () => this.enterNewMode())
        this.saveBtn = this.makeIconButton("EdSave", this.saveIconTex, -30, 1, () => this.enterSaveMode())
        // 9 units apart — the same pill spacing the tabs use.
        this.publicBtn = this.makePillButton("EdSavePublic", "All Docs", -30, 1, () => this.doSave(true))
        this.privateBtn = this.makePillButton("EdSavePrivate", "My Docs", -39, 1, () => this.doSave(false))
        this.driveSaveBtn = this.makeIconButton("EdSaveDrive", this.driveIconTex, -53, 1, () => this.doSaveToDrive())
        this.githubSaveBtn = this.makeIconButton("EdSaveGitHub", this.githubIconTex, -60, 1, () => this.doSaveToGitHub())
        this.blankBtn = this.makePillButton("EdNewBlank", "Blank Doc", -30, -7, () => { this.exitNewMode(); this.newDoc() })
        this.driveOpenBtn = this.makeIconButton("EdNewFromDrive", this.driveIconTex, -41, -7, () => { this.exitNewMode(); this.openFromDrive() })
        this.githubOpenBtn = this.makeIconButton("EdNewFromGitHub", this.githubIconTex, -48, -7, () => { this.exitNewMode(); this.openFromGitHub() })
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

    // The choice pills are REAL UIKit CapsuleButtons (the DocButton prefab —
    // the same component the tabs are built from), so they are exactly the
    // tab style: same capsule mesh, glass material, and label styling.
    // Falls back to a textured Image pill if the prefab isn't wired.
    private makePillButton(name: string, label: string, x: number, y: number, cb: () => void): SceneObject {
        if (this.pillPrefab) {
            const obj = this.pillPrefab.instantiate(this.parent())
            obj.name = name
            obj.enabled = true
            obj.getTransform().setLocalPosition(new vec3(x, y, 0.3))
            // Exactly the tab spec: 8x3 capsule, 28pt default-font white label.
            this.sizeCapsule(obj, 8, 3)
            const t: any = findText(obj)
            if (t) {
                t.text = label
                try { t.size = 28 } catch (e) {}
            }
            bindActivate(obj, cb)   // uses the button's own onTriggerUp
            return obj
        }
        const obj = global.scene.createSceneObject(name)
        obj.setParent(this.parent())
        obj.getTransform().setLocalPosition(new vec3(x, y, 0.3))
        const bg = global.scene.createSceneObject("bg")
        bg.setParent(obj)
        bg.getTransform().setLocalScale(new vec3(12.5, 5, 1))
        this.texImage(bg, this.pillTex)
        try {
            const t = obj.createComponent("Component.Text") as any
            t.text = label
            t.size = 17
            if (this.labelFont) t.font = this.labelFont
            t.horizontalAlignment = HorizontalAlignment.Center
            t.verticalAlignment = VerticalAlignment.Center
            t.textFill.color = new vec4(1, 1, 1, 1)
            t.renderOrder = 3
        } catch (e) {}
        this.installHit(obj, cb, 12.5, 5)
        return obj
    }

    // Resize a UIKit button and force the pill shape (cornerRadius = h/2,
    // exactly what CapsuleButton — the tabs — does internally). The button
    // only builds its visual when it initializes, which for the choice pills
    // is the first time they're ENABLED (they're created disabled), so this
    // polls until the visual exists. Re-invoked from enterSaveMode /
    // enterNewMode so pills enabled long after startup still get shaped.
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
                print("EditorTabController: pill shaped (" + obj.name + ")")
                return
            }
            if (tries++ > 40) return
            const ev = this.createEvent("DelayedCallbackEvent")
            ev.bind(tick)
            ev.reset(0.25)
        }
        tick()
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

    // The user-set title (from the title field); derive from the body only
    // when a doc somehow has none.
    private docTitle(doc: DocumentRecord): string {
        return (doc.title && doc.title.trim().length > 0) ? doc.title.trim() : deriveTitle(doc.body)
    }

    /** "Trip notes.txt" -> "Trip notes" (imported docs keep their file name). */
    private titleFromFileName(name: string): string {
        return (name || "").replace(/\.txt$/i, "").trim()
    }

    private renderDoc(doc: DocumentRecord) {
        if (!this.editor) return
        this.editor.setHint(doc.body.length === 0)
        this.editor.setContent(doc.body, "bottom", true)
    }

    private newDoc() {
        if (this.documentManager) this.documentManager.newDocument()
    }

    // --- Save flow: Save -> [All Docs | My Docs | Drive | GitHub] -> back ---
    private enterSaveMode(): void {
        this.exitNewMode()
        if (this.saveBtn) this.saveBtn.enabled = false
        if (this.publicBtn) this.publicBtn.enabled = true
        if (this.privateBtn) this.privateBtn.enabled = true
        if (this.driveSaveBtn) this.driveSaveBtn.enabled = true
        if (this.githubSaveBtn) this.githubSaveBtn.enabled = true
        // The UIKit buttons initialize on first enable — shape them now.
        if (this.pillPrefab) {
            this.sizeCapsule(this.publicBtn, 8, 3)
            this.sizeCapsule(this.privateBtn, 8, 3)
        }
    }
    private exitSaveMode(): void {
        if (this.publicBtn) this.publicBtn.enabled = false
        if (this.privateBtn) this.privateBtn.enabled = false
        if (this.driveSaveBtn) this.driveSaveBtn.enabled = false
        if (this.githubSaveBtn) this.githubSaveBtn.enabled = false
        if (this.saveBtn) this.saveBtn.enabled = true
    }
    private doSave(isPublic: boolean): void {
        if (this.documentManager) this.documentManager.saveCurrent(isPublic)
        this.exitSaveMode()
    }

    // --- New Doc flow: New -> [Blank Doc | Drive | GitHub] -> back to New ---
    private enterNewMode(): void {
        this.exitSaveMode()
        if (this.newDocBtn) this.newDocBtn.enabled = false
        if (this.blankBtn) this.blankBtn.enabled = true
        if (this.driveOpenBtn) this.driveOpenBtn.enabled = true
        if (this.githubOpenBtn) this.githubOpenBtn.enabled = true
        // The UIKit button initializes on first enable — shape it now.
        if (this.pillPrefab) this.sizeCapsule(this.blankBtn, 8, 3)
    }
    private exitNewMode(): void {
        if (this.blankBtn) this.blankBtn.enabled = false
        if (this.driveOpenBtn) this.driveOpenBtn.enabled = false
        if (this.githubOpenBtn) this.githubOpenBtn.enabled = false
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
        const title = this.docTitle(doc)
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
            const doc = this.documentManager.openImported(body, this.titleFromFileName(f.name))
            // Re-saving this doc to Drive updates the same file, not a copy.
            this.googleDrive.rememberFileId(doc.id, f.id)
            this.drivePanel.hide()
        }).catch((e: any) => {
            this.drivePanel.showStatus("Drive open failed: " + e, 6)
        })
    }

    // --- GitHub flows -------------------------------------------------------
    // Same shape as Drive, but sign-in is GitHub's device flow: the popup
    // shows a short code the wearer enters at github.com/login/device on
    // their phone while the lens polls for the grant.
    private doSaveToGitHub(): void {
        this.exitSaveMode()
        this.withGitHubAuth("Saving to GitHub needs your GitHub account.", () => this.saveToGitHub())
    }

    private openFromGitHub(): void {
        this.withGitHubAuth("Opening from GitHub needs your GitHub account.", () => this.listGitHubFiles())
    }

    private withGitHubAuth(why: string, action: () => void): void {
        if (!this.github || !this.drivePanel) {
            print("EditorTabController: github/drivePanel not wired.")
            return
        }
        if (!this.github.isConfigured()) {
            this.drivePanel.showStatus("Set clientId + repoOwner/repoName on the GitHubStore component", 5, "GitHub")
            return
        }
        if (this.github.isSignedIn()) {
            action()
            return
        }
        this.drivePanel.showSignIn(why + "\nYou'll get a code to enter on your phone.", () => {
            this.drivePanel.setStatus("Requesting sign-in code…")
            this.github.signIn((code: string, uri: string) => {
                this.drivePanel.setStatus("On your phone open\n" + uri + "\nand enter code:  " + code)
            }).then(() => action())
                .catch((e: any) => this.drivePanel.showStatus("Sign-in failed: " + e, 6, "GitHub"))
        }, "GitHub", "Sign in with GitHub")
    }

    private saveToGitHub(): void {
        const doc = this.documentManager ? this.documentManager.getCurrentDoc() : null
        if (!doc || doc.body.trim().length === 0) {
            this.drivePanel.showStatus("Nothing to save yet — type something first", 4, "GitHub")
            return
        }
        const title = this.docTitle(doc)
        this.drivePanel.showStatus("Committing \"" + title + ".txt\" to the repo…", 0, "GitHub")
        this.github.saveTextFile(doc.id, title, doc.body).then(() => {
            this.drivePanel.showStatus("Saved \"" + title + ".txt\" to GitHub", 4, "GitHub")
        }).catch((e: any) => {
            this.drivePanel.showStatus("GitHub save failed: " + e, 6, "GitHub")
        })
    }

    private listGitHubFiles(): void {
        this.drivePanel.showStatus("Loading repo documents…", 0, "GitHub")
        this.github.listTextFiles().then((files: DriveFile[]) => {
            this.drivePanel.showFiles(files, (f: DriveFile) => this.openGitHubFile(f),
                "Open from GitHub", "No .txt files in the repo")
        }).catch((e: any) => {
            this.drivePanel.showStatus("GitHub list failed: " + e, 6, "GitHub")
        })
    }

    private openGitHubFile(f: DriveFile): void {
        this.drivePanel.setStatus("Opening \"" + f.name + "\"…")
        this.github.downloadTextFile(f.id).then((body: string) => {
            const doc = this.documentManager.openImported(body, this.titleFromFileName(f.name))
            // Re-saving this doc to GitHub updates the same repo file.
            this.github.rememberPath(doc.id, f.id)
            this.drivePanel.hide()
        }).catch((e: any) => {
            this.drivePanel.showStatus("GitHub open failed: " + e, 6, "GitHub")
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
        if (this.githubOpenBtn && this.githubOpenBtn.enabled) items.push({ sceneObject: this.githubOpenBtn, activate: () => { this.exitNewMode(); this.openFromGitHub() } })
        if (this.saveBtn && this.saveBtn.enabled) items.push({ sceneObject: this.saveBtn, activate: () => this.enterSaveMode() })
        if (this.publicBtn && this.publicBtn.enabled) items.push({ sceneObject: this.publicBtn, activate: () => this.doSave(true) })
        if (this.privateBtn && this.privateBtn.enabled) items.push({ sceneObject: this.privateBtn, activate: () => this.doSave(false) })
        if (this.driveSaveBtn && this.driveSaveBtn.enabled) items.push({ sceneObject: this.driveSaveBtn, activate: () => this.doSaveToDrive() })
        if (this.githubSaveBtn && this.githubSaveBtn.enabled) items.push({ sceneObject: this.githubSaveBtn, activate: () => this.doSaveToGitHub() })
        return items
    }
}
