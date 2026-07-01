// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Small duck-typed helpers for SUIK components, so we don't depend on exact
// package import paths. A "button" is any script component exposing onTriggerUp;
// a "text input" exposes onTextChanged + a text property.

/** Find a SUIK button (onTriggerUp) on obj or its children (2 levels). */
export function findButton(obj: SceneObject): any {
    if (!obj) return null
    const scan = (host: SceneObject): any => {
        const scripts = host.getComponents("Component.ScriptComponent")
        for (let i = 0; i < scripts.length; i++) {
            const s = scripts[i] as any
            if (s && s.onTriggerUp && s.onTriggerUp.add) return s
        }
        return null
    }
    const direct = scan(obj)
    if (direct) return direct
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const child = obj.getChild(c)
        const m = scan(child)
        if (m) return m
        for (let g = 0; g < child.getChildrenCount(); g++) {
            const gm = scan(child.getChild(g))
            if (gm) return gm
        }
    }
    return null
}

/** Find a Text component on obj or children (2 levels). */
export function findText(obj: SceneObject): Text | null {
    if (!obj) return null
    let comps = obj.getComponents("Component.Text")
    if (comps.length > 0) return comps[0] as Text
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const child = obj.getChild(c)
        comps = child.getComponents("Component.Text")
        if (comps.length > 0) return comps[0] as Text
        for (let g = 0; g < child.getChildrenCount(); g++) {
            comps = child.getChild(g).getComponents("Component.Text")
            if (comps.length > 0) return comps[0] as Text
        }
    }
    return null
}

/** Find a SUIK TextInputField (onTextChanged) on obj or children (2 levels). */
export function findTextInput(obj: SceneObject): any {
    if (!obj) return null
    const scan = (host: SceneObject): any => {
        const scripts = host.getComponents("Component.ScriptComponent")
        for (let i = 0; i < scripts.length; i++) {
            const s = scripts[i] as any
            if (s && (s.onTextChanged || s.onEditingStarted)) return s
        }
        return null
    }
    const direct = scan(obj)
    if (direct) return direct
    for (let c = 0; c < obj.getChildrenCount(); c++) {
        const child = obj.getChild(c)
        const m = scan(child)
        if (m) return m
        for (let g = 0; g < child.getChildrenCount(); g++) {
            const gm = scan(child.getChild(g))
            if (gm) return gm
        }
    }
    return null
}

/** Grow a ScrollWindow's content height (it does not auto-grow from children). */
export function setScrollHeight(scrollWindow: any, totalHeight: number): void {
    if (!scrollWindow) return
    const sw = scrollWindow as any
    if (sw.isInitialized === false) return
    try {
        const dims = (typeof sw.getScrollDimensions === "function")
            ? sw.getScrollDimensions()
            : (sw.scrollDimensions || new vec2(32, totalHeight))
        if (typeof sw.setScrollDimensions === "function") {
            sw.setScrollDimensions(new vec2(dims.x, totalHeight))
        } else {
            sw.scrollDimensions = new vec2(dims.x, totalHeight)
        }
    } catch (e) {
        print("UiUtil.setScrollHeight: " + e)
    }
}
