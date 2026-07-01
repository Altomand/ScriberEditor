// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Docs bottom bar: the query box becomes a document SEARCH field, the mic does
// speech-to-text into it, and the bottom-left button is "New Doc". Mic/ASR is
// ported from bendConduit's BobAssistant.

import Event from "./Event"
import {DocsListController} from "./DocsListController"
import {FocusItem} from "./FocusNavigator"
import {findTextInput} from "./UiUtil"
import {bindActivate} from "./HighlightRing"

@component
export class SearchController extends BaseScriptComponent {

    @input
    docsList: DocsListController

    @input
    @allowUndefined
    @hint("Optional host SceneObject of the search TextInputField")
    searchInputHost: SceneObject

    @input
    @allowUndefined
    micButton: SceneObject

    @input
    @allowUndefined
    newDocButton: SceneObject

    @input
    @allowUndefined
    @hint("Transparent-unlit material (e.g. EmojiCool) — cloned to paint the mic icon")
    uiTextureMaterial: Material
    @input
    @allowUndefined
    @hint("Texture: white mic icon")
    micTexture: Texture

    @input
    @allowUndefined
    @hint("ASR module asset for mic speech-to-text")
    asrModule: any

    private searchInput: any = null
    private isListening: boolean = false

    private onNewRequestedEvent = new Event<void>()
    public onNewRequested = this.onNewRequestedEvent.publicApi()

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.searchInput = findTextInput(this.searchInputHost)
        if (this.searchInput && this.searchInput.onTextChanged && this.searchInput.onTextChanged.add) {
            this.searchInput.onTextChanged.add(() => {
                if (this.docsList) this.docsList.filter(this.searchInput.text || "")
            })
        }
        if (this.micButton) bindActivate(this.micButton, () => this.onMicPressed())
        if (this.newDocButton) bindActivate(this.newDocButton, () => this.onNewRequestedEvent.invoke())
        this.applyMicIcon()
    }

    // The mic Image ships with no material (renders magenta). Paint it at runtime
    // with the mic texture on a cloned transparent-unlit material (same as the
    // round icon buttons), since a static .mat collided with EmojiCool's fixed id.
    private applyMicIcon(): void {
        if (!this.micButton || !this.uiTextureMaterial || !this.micTexture) return
        const img = this.findImage(this.micButton)
        if (!img) { print("SearchController: mic Image not found"); return }
        try {
            const m = this.uiTextureMaterial.clone()
            m.mainPass.baseTex = this.micTexture
            img.mainMaterial = m
        } catch (e) { print("SearchController: mic icon failed: " + e) }
    }

    private findImage(root: SceneObject): any {
        const direct = root.getComponent("Component.Image") as any
        if (direct) return direct
        for (let i = 0; i < root.getChildrenCount(); i++) {
            const r = this.findImage(root.getChild(i))
            if (r) return r
        }
        return null
    }

    private onMicPressed(): void {
        if (this.isListening || !this.asrModule) return
        try {
            const options = AsrModule.AsrTranscriptionOptions.create()
            options.silenceUntilTerminationMs = 1500
            options.mode = AsrModule.AsrMode.HighAccuracy
            options.onTranscriptionUpdateEvent.add((e: any) => {
                if (e.text && this.searchInput) {
                    this.searchInput.text = e.text.trim()
                    if (this.docsList) this.docsList.filter(this.searchInput.text)
                }
                if (e.isFinal) {
                    this.isListening = false
                    this.asrModule.stopTranscribing()
                }
            })
            options.onTranscriptionErrorEvent.add(() => {
                this.isListening = false
            })
            this.asrModule.startTranscribing(options)
            this.isListening = true
        } catch (err) {
            print("SearchController: ASR unavailable: " + err)
            this.isListening = false
        }
    }

    public getFocusItems(): FocusItem[] {
        const items: FocusItem[] = []
        if (this.newDocButton) {
            items.push({ sceneObject: this.newDocButton, activate: () => this.onNewRequestedEvent.invoke() })
        }
        if (this.searchInputHost) {
            items.push({
                sceneObject: this.searchInputHost,
                activate: () => { if (this.searchInput && this.searchInput.startEditing) this.searchInput.startEditing() },
            })
        }
        if (this.micButton) {
            items.push({ sceneObject: this.micButton, activate: () => this.onMicPressed() })
        }
        return items
    }
}
