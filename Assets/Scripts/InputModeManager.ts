// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Global input mode: NAVIGATION (Scriber joystick/buttons move a focus ring
// between UI elements) vs TYPING (Scriber keypresses go into the editor).
// The single gate that keeps joystick input from corrupting text — every flip
// must go through here, set from DocumentPanelController on tab switch plus one
// explicit Scriber toggle.

import Event from "./Event"

export enum InputMode {
    NAVIGATION = 0,
    TYPING = 1,
}

@component
export class InputModeManager extends BaseScriptComponent {

    private mode: InputMode = InputMode.NAVIGATION

    private onModeChangedEvent = new Event<InputMode>()
    public onModeChanged = this.onModeChangedEvent.publicApi()

    public getMode(): InputMode {
        return this.mode
    }

    public isTyping(): boolean {
        return this.mode === InputMode.TYPING
    }

    public setMode(mode: InputMode): void {
        if (mode === this.mode) return
        this.mode = mode
        print("InputMode: " + (mode === InputMode.TYPING ? "TYPING" : "NAVIGATION"))
        this.onModeChangedEvent.invoke(mode)
    }

    public toggle(): void {
        this.setMode(this.mode === InputMode.TYPING ? InputMode.NAVIGATION : InputMode.TYPING)
    }
}
