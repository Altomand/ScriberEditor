// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Settings: pick two keys via dropdowns and swap their positions in the virtual
// keyboard. The swap is applied live and persisted for next launch.

import {SimpleDropdown} from "./SimpleDropdown"
import {VirtualKeyboard} from "./VirtualKeyboard"
import {flattenLayout, swapCells, KeyRef} from "./KeyboardLayout"
import {addSwap} from "./LayoutOverrides"
import {bindActivate} from "./HighlightRing"
import {FocusItem} from "./FocusNavigator"

@component
export class KeyboardLayoutEditor extends BaseScriptComponent {

    @input
    dropdownA: SimpleDropdown

    @input
    dropdownB: SimpleDropdown

    @input
    @hint("Button that applies the swap")
    applyButton: SceneObject

    @input
    virtualKeyboard: VirtualKeyboard

    private keys: KeyRef[] = []

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        this.refreshOptions()
        if (this.applyButton) bindActivate(this.applyButton, () => this.applySwap())
    }

    private refreshOptions() {
        this.keys = flattenLayout()
        const labels = this.keys.map(k => k.label + "  (" + this.sectionName(k.section) + " r" + (k.row + 1) + " k" + (k.col + 1) + ")")
        if (this.dropdownA) this.dropdownA.setOptions(labels)
        if (this.dropdownB) this.dropdownB.setOptions(labels)
    }

    private sectionName(section: number): string {
        return ["Center", "Top", "Left", "Right", "Bottom"][section] || "?"
    }

    public applySwap() {
        if (!this.dropdownA || !this.dropdownB) return
        const ai = this.dropdownA.getSelectedIndex()
        const bi = this.dropdownB.getSelectedIndex()
        if (ai === bi) return
        const a = this.keys[ai], b = this.keys[bi]
        if (!a || !b) return
        swapCells(a, b)
        addSwap(a, b)
        if (this.virtualKeyboard) this.virtualKeyboard.refreshLabels()
        this.refreshOptions()
        print("KeyboardLayoutEditor: swapped " + a.label + " <-> " + b.label)
    }

    public getFocusItems(): FocusItem[] {
        let items: FocusItem[] = []
        if (this.dropdownA) items = items.concat(this.dropdownA.getFocusItems())
        if (this.dropdownB) items = items.concat(this.dropdownB.getFocusItems())
        if (this.applyButton) items.push({ sceneObject: this.applyButton, activate: () => this.applySwap() })
        return items
    }
}
