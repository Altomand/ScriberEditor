// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Settings tab: text-editor options (font size, autosave) + the keyboard
// key-swap editor. Settings persist under settings:* keys.

import {DocumentManager} from "./DocumentManager"
import {KeyboardLayoutEditor} from "./KeyboardLayoutEditor"
import {FocusItem} from "./FocusNavigator"
import {findButton} from "./UiUtil"

@component
export class SettingsController extends BaseScriptComponent {

    @input
    @allowUndefined
    @hint("Editor text component (font size is applied here)")
    editorText: Text

    @input
    @allowUndefined
    @hint("Host of a SUIK Slider for font size (duck-typed onValueChanged 0..1)")
    fontSizeSliderHost: SceneObject

    @input
    fontMin: number = 24

    @input
    fontMax: number = 52

    @input
    @allowUndefined
    documentManager: DocumentManager

    @input
    layoutEditor: KeyboardLayoutEditor

    private store: GeneralDataStore

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.store = global.persistentStorageSystem.store
        this.loadFontSize()
        this.wireFontSlider()
    }

    private loadFontSize() {
        if (this.editorText && this.store.has("settings:fontSize")) {
            try {
                const sz = this.store.getString("settings:fontSize")
                const n = parseFloat(sz)
                if (!isNaN(n)) this.editorText.size = n
            } catch (e) {}
        }
    }

    private wireFontSlider() {
        const s = this.findSlider(this.fontSizeSliderHost)
        if (s && s.onValueChanged && s.onValueChanged.add) {
            s.onValueChanged.add((v: any) => {
                const t = typeof v === "number" ? v : (v && v.value ? v.value : 0)
                const size = this.fontMin + (this.fontMax - this.fontMin) * Math.max(0, Math.min(1, t))
                if (this.editorText) this.editorText.size = size
                this.store.putString("settings:fontSize", "" + size)
            })
        }
    }

    private findSlider(obj: SceneObject): any {
        if (!obj) return null
        const scripts = obj.getComponents("Component.ScriptComponent")
        for (let i = 0; i < scripts.length; i++) {
            const s = scripts[i] as any
            if (s && s.onValueChanged) return s
        }
        return null
    }

    public getFocusItems(): FocusItem[] {
        let items: FocusItem[] = []
        if (this.fontSizeSliderHost) {
            items.push({ sceneObject: this.fontSizeSliderHost, activate: () => {} })
        }
        if (this.layoutEditor) items = items.concat(this.layoutEditor.getFocusItems())
        return items
    }
}
