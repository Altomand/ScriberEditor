// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Orchestrates the document panel. Tabs (left→right): Editor | My Docs | All Docs,
// plus a round gear button for Settings. Editor is the default view. My Docs lists
// the user's private docs; All Docs lists every user's public docs with cool
// points. Modeled on bendConduit's ConversationController.setView + tab visuals.
//
// NOTE: legacy @input field names are kept (to avoid re-wiring churn) and remapped
// by view in code:  editorViewRoot=Editor, docsViewRoot=My Docs,
// allDocsViewRoot=All Docs, settingsViewRoot=Settings;  tab buttons left→right are
// docsTabButton→Editor, editorTabButton→My Docs, settingsTabButton→All Docs;
// dots docsTabSelected→Editor, editorTabSelected→My Docs, settingsTabSelected→All Docs.

import {DocumentManager} from "./DocumentManager"
import {DocsListController} from "./DocsListController"
import {SearchController} from "./SearchController"
import {EditorTabController} from "./EditorTabController"
import {SettingsController} from "./SettingsController"
import {FocusNavigator, FocusItem} from "./FocusNavigator"
import {InputModeManager, InputMode} from "./InputModeManager"
import {bindActivate} from "./HighlightRing"

type View = "editor" | "mydocs" | "alldocs" | "settings"

@component
export class DocumentPanelController extends BaseScriptComponent {

    @input documentManager: DocumentManager
    @input docsList: DocsListController          // My Docs list (listMode = "mine")
    @input searchController: SearchController
    @input editorTab: EditorTabController
    @input settings: SettingsController
    @input focusNavigator: FocusNavigator
    @input inputMode: InputModeManager

    @input @allowUndefined
    @hint("All Docs list (a 2nd DocsListController with listMode = public)")
    allDocsList: DocsListController

    // View roots (legacy names, remapped — see header).
    @input editorViewRoot: SceneObject
    @input docsViewRoot: SceneObject
    @input @allowUndefined allDocsViewRoot: SceneObject
    @input settingsViewRoot: SceneObject

    // Tab buttons, left→right: tab1 = Editor, tab2 = My Docs, tab3 = All Docs.
    @input docsTabButton: SceneObject       // tab 1 → Editor
    @input editorTabButton: SceneObject     // tab 2 → My Docs
    @input settingsTabButton: SceneObject   // tab 3 → All Docs
    @input @allowUndefined gearButton: SceneObject   // round gear → Settings

    // Selected dots under each tab (remapped).
    @input @allowUndefined docsTabSelected: SceneObject       // lights for Editor
    @input @allowUndefined editorTabSelected: SceneObject     // lights for My Docs
    @input @allowUndefined settingsTabSelected: SceneObject   // lights for All Docs

    @input @allowUndefined @hint("My-Docs-only bottom bar (search/mic/New Doc)")
    bottomBar: SceneObject

    private activeView: View = "editor"

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.bindTab(this.docsTabButton, () => this.showEditor())      // tab 1
        this.bindTab(this.editorTabButton, () => this.showMyDocs())    // tab 2
        this.bindTab(this.settingsTabButton, () => this.showAllDocs()) // tab 3
        this.bindTab(this.gearButton, () => this.showSettings())       // gear

        if (this.docsList) {
            this.docsList.onOpenRequested.add((id: string) => this.openDoc(id))
            this.docsList.onNewRequested.add(() => this.newDoc())
            this.docsList.onRebuilt.add(() => { if (this.activeView === "mydocs") this.composeFocus() })
        }
        if (this.allDocsList) {
            this.allDocsList.onOpenRequested.add((id: string) => this.openDoc(id))
            this.allDocsList.onRebuilt.add(() => { if (this.activeView === "alldocs") this.composeFocus() })
        }
        if (this.searchController) {
            this.searchController.onNewRequested.add(() => this.newDoc())
        }

        // NOTE: docsViewRoot / allDocsViewRoot are re-pointed (in the scene) to the
        // CardContainers, NOT the actual view-root objects. The view roots stay
        // permanently enabled so their SUIK ScrollWindows initialize at scene start
        // (a ScrollWindow skips init if disabled then and never recovers — exactly
        // bendConduit's always-enabled-ScrollWindow pattern). setView therefore
        // toggles just the card content; the ScrollWindow underneath is always live.
        this.showEditor()   // default view
    }

    private bindTab(host: SceneObject, cb: () => void) {
        if (host) bindActivate(host, cb)
    }

    public showEditor() { this.setView("editor") }
    public showMyDocs() { this.setView("mydocs") }
    public showAllDocs() { this.setView("alldocs") }
    public showSettings() { this.setView("settings") }

    private openDoc(id: string) {
        if (!this.documentManager) return
        this.documentManager.openDocument(id).then(() => this.showEditor())
    }

    private newDoc() {
        if (!this.documentManager) return
        this.documentManager.newDocument()
        this.showEditor()
    }

    private setView(view: View) {
        this.activeView = view
        if (this.editorViewRoot) this.editorViewRoot.enabled = (view === "editor")
        if (this.docsViewRoot) this.docsViewRoot.enabled = (view === "mydocs")
        if (this.allDocsViewRoot) this.allDocsViewRoot.enabled = (view === "alldocs")
        if (this.settingsViewRoot) this.settingsViewRoot.enabled = (view === "settings")

        // Tab dots (remapped): tab1=Editor, tab2=My Docs, tab3=All Docs.
        if (this.docsTabSelected) this.docsTabSelected.enabled = (view === "editor")
        if (this.editorTabSelected) this.editorTabSelected.enabled = (view === "mydocs")
        if (this.settingsTabSelected) this.settingsTabSelected.enabled = (view === "alldocs")

        // Search/mic show while browsing docs, never in the Editor or Settings.
        if (this.bottomBar) this.bottomBar.enabled = (view === "mydocs" || view === "alldocs")

        // Input mode: only the Editor types; everything else navigates.
        if (this.inputMode) {
            this.inputMode.setMode(view === "editor" ? InputMode.TYPING : InputMode.NAVIGATION)
        }

        if (view === "editor" && this.editorTab) {
            this.editorTab.enter()
        } else if (view === "mydocs" && this.docsList) {
            this.docsList.refresh()         // async; composeFocus runs on onRebuilt
        } else if (view === "alldocs" && this.allDocsList) {
            this.allDocsList.refresh()      // re-ranks by cool points
        }
        this.composeFocus()
        print("DocumentPanelController: view = " + view)
    }

    private composeFocus() {
        if (!this.focusNavigator) return
        let items: FocusItem[] = []
        if (this.activeView === "editor") {
            if (this.editorTab) items = items.concat(this.editorTab.getFocusItems())
        } else if (this.activeView === "mydocs") {
            if (this.searchController) items = items.concat(this.searchController.getFocusItems())
            if (this.docsList) items = items.concat(this.docsList.getCardFocusItems())
        } else if (this.activeView === "alldocs") {
            if (this.allDocsList) items = items.concat(this.allDocsList.getCardFocusItems())
        } else {
            if (this.settings) items = items.concat(this.settings.getFocusItems())
        }
        // Settings stays reachable from any non-editor view via the gear (pinch always works).
        if (this.gearButton && this.activeView !== "editor") {
            items.push({ sceneObject: this.gearButton, activate: () => this.showSettings() })
        }
        // SUIK buttons + card buttons handle their own pinch, so don't add colliders.
        this.focusNavigator.setFocusables(items, true)
    }
}
