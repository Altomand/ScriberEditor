// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Minimal dropdown (SUIK has no Dropdown component). A toggle button shows/hides
// a list of option rows; selecting one fires onSelected(index) and closes.

import Event from "./Event"
import {FocusItem} from "./FocusNavigator"
import {installInteractable, bindActivate} from "./HighlightRing"

@component
export class SimpleDropdown extends BaseScriptComponent {

    @input
    @hint("Text showing the current selection")
    labelText: Text

    @input
    @hint("Button SceneObject that opens/closes the list")
    toggleButton: SceneObject

    @input
    @hint("Container whose .enabled toggles the option list")
    listRoot: SceneObject

    @input
    @allowUndefined
    @hint("Deprecated/unused — rows are built at runtime. Kept optional for compatibility.")
    optionRowPrefab: ObjectPrefab

    @input
    @allowUndefined
    @hint("Font for option rows")
    rowFont: Font

    @input
    rowFontSize: number = 26

    @input
    @hint("Vertical spacing between option rows (local units)")
    rowSpacing: number = 6

    private options: string[] = []
    private rows: SceneObject[] = []
    private selectedIndex: number = 0
    private open: boolean = false

    private onSelectedEvent = new Event<number>()
    public onSelected = this.onSelectedEvent.publicApi()

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => {
            if (this.toggleButton) bindActivate(this.toggleButton, () => this.toggleOpen())
            if (this.listRoot) this.listRoot.enabled = false
        })
    }

    public setOptions(opts: string[]): void {
        this.options = opts
        this.rebuildRows()
        this.setSelected(this.selectedIndex < opts.length ? this.selectedIndex : 0, false)
    }

    public getSelectedIndex(): number {
        return this.selectedIndex
    }

    public setSelected(i: number, fire: boolean): void {
        if (i < 0 || i >= this.options.length) return
        this.selectedIndex = i
        if (this.labelText) this.labelText.text = this.options[i]
        if (fire) this.onSelectedEvent.invoke(i)
    }

    private rebuildRows(): void {
        for (const r of this.rows) r.destroy()
        this.rows = []
        if (!this.listRoot) return
        for (let i = 0; i < this.options.length; i++) {
            const row = global.scene.createSceneObject("opt_" + i)
            row.setParent(this.listRoot)
            const txt = row.createComponent("Component.Text") as any
            txt.text = this.options[i]
            txt.size = this.rowFontSize
            if (this.rowFont) txt.font = this.rowFont
            const t = row.getTransform()
            t.setLocalPosition(new vec3(0, -i * this.rowSpacing, 0))
            const idx = i
            installInteractable(row, () => { this.setSelected(idx, true); this.close() })
            this.rows.push(row)
        }
    }

    private toggleOpen(): void {
        this.open = !this.open
        if (this.listRoot) this.listRoot.enabled = this.open
    }

    private close(): void {
        this.open = false
        if (this.listRoot) this.listRoot.enabled = false
    }

    /** Focus items: the toggle plus (when open) each row. */
    public getFocusItems(): FocusItem[] {
        const items: FocusItem[] = []
        if (this.toggleButton) items.push({ sceneObject: this.toggleButton, activate: () => this.toggleOpen() })
        if (this.open) {
            for (let i = 0; i < this.rows.length; i++) {
                const idx = i
                items.push({ sceneObject: this.rows[i], activate: () => { this.setSelected(idx, true); this.close() } })
            }
        }
        return items
    }
}
