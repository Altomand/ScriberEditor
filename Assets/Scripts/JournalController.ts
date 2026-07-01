// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// JournalController — thin keypress router. Document state, persistence, and
// the org-mode session heading now live in DocumentManager; this just routes
// Scriber/BLE keypresses into the current document while in TYPING mode and
// renders the result in the editor.

import {BleKeyboard, KeypressData} from "./BleKeyboard"
import {ScrollableTextEditor} from "./ScrollableTextEditor"
import {DocumentManager} from "./DocumentManager"
import {InputModeManager} from "./InputModeManager"

@component
export class JournalController extends BaseScriptComponent {

    @input
    bleKeyboard: BleKeyboard

    @input
    @hint("ScrollableTextEditor view component")
    editor: ScrollableTextEditor

    @input
    @hint("DocumentManager that owns the current document buffer")
    documentManager: DocumentManager

    @input
    @allowUndefined
    @hint("InputModeManager. Keypresses are only applied while in TYPING mode.")
    inputMode: InputModeManager

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        if (this.bleKeyboard && this.bleKeyboard.onKeypress) {
            this.bleKeyboard.onKeypress.add(this.onKeypress.bind(this))
        } else {
            print("JournalController: bleKeyboard not wired; keypresses ignored.")
        }
    }

    private onKeypress(data: KeypressData) {
        // While navigating UI, the FocusNavigator consumes Scriber input; only
        // type when explicitly in TYPING mode.
        if (this.inputMode && !this.inputMode.isTyping()) return
        if (!this.documentManager) return

        const changed = this.documentManager.appendKey(data.key)
        if (!changed) return

        if (this.editor) {
            this.editor.setHint(false)
            this.editor.setContent(this.documentManager.getBuffer())
        }
    }

    /** Back-compat accessor used by other scripts. */
    public getBuffer(): string {
        return this.documentManager ? this.documentManager.getBuffer() : ""
    }
}
