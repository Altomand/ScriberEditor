// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.
//
// Shared selection-highlight helpers, factored from bendConduit's
// ChecklistEditController. Two strategies so it works across element types:
//   - createCloneRing(): clone a target's mesh as a larger yellow ring (cards).
//   - tintFocus(): fall back to tinting a target's first visual yellow (buttons),
//     remembering the original color to restore on blur.
// installInteractable() adds a collider + SIK Interactable so pinch works
// alongside the Scriber focus-ring (both converge on one activate callback).

const YELLOW = new vec4(1.0, 0.85, 0.1, 1.0)

import {findButton} from "./UiUtil"

const Interactable = require("SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable").Interactable

function findRMV(obj: SceneObject): RenderMeshVisual | null {
    const own = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (own) return own
    for (let i = 0; i < obj.getChildrenCount(); i++) {
        const c = obj.getChild(i)
        if (c.name === "Background") {
            const r = c.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
            if (r) return r
        }
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
        const r = obj.getChild(i).getComponent("Component.RenderMeshVisual") as RenderMeshVisual
        if (r) return r
    }
    return null
}

function tintPass(mp: any, color: vec4): void {
    if (!mp) return
    try { mp.baseColor = color } catch (e) {}
    try { mp.baseColorTint = color } catch (e) {}
    try { mp.albedoColor = color } catch (e) {}
    try { mp.color = color } catch (e) {}
}

/** Clone-ring: a slightly larger yellow copy of the target's mesh, behind it. */
export function createCloneRing(target: SceneObject): SceneObject | null {
    const srcRMV = findRMV(target)
    if (!srcRMV || !srcRMV.mainMaterial) return null  // need a material to clone+tint
    try {
        const ring = global.scene.createSceneObject("FocusRing")
        ring.setParent(target)
        const t = ring.getTransform()
        t.setLocalScale(new vec3(1.12, 1.18, 1.0))
        t.setLocalPosition(new vec3(0, 0, -0.05))
        const rmv = ring.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
        rmv.mesh = srcRMV.mesh
        const mat = srcRMV.mainMaterial.clone()
        rmv.mainMaterial = mat
        tintPass(mat.mainPass as any, YELLOW)
        ring.enabled = false
        return ring
    } catch (e) {
        print("HighlightRing: createCloneRing failed: " + e)
        return null
    }
}

// Remember original colors per object so tintFocus can restore them.
const _originalColors: { obj: SceneObject, color: vec4 }[] = []

function rememberColor(obj: SceneObject, color: vec4): void {
    for (const e of _originalColors) { if (e.obj === obj) return }
    _originalColors.push({ obj: obj, color: color })
}
function recallColor(obj: SceneObject): vec4 | null {
    for (const e of _originalColors) { if (e.obj === obj) return e.color }
    return null
}

/** Fallback focus: tint the target's first visual yellow / restore it. */
export function tintFocus(target: SceneObject, focused: boolean): void {
    const rmv = findRMV(target)
    if (rmv && rmv.mainMaterial) {
        const mp = rmv.mainMaterial.mainPass as any
        if (focused) {
            try { rememberColor(target, mp.baseColor) } catch (e) {}
            tintPass(mp, YELLOW)
        } else {
            const orig = recallColor(target)
            if (orig) tintPass(mp, orig)
        }
        return
    }
    // Text fallback
    const txt = target.getComponent("Component.Text") as any
    if (txt && txt.textFill) {
        if (focused) {
            rememberColor(target, txt.textFill.color)
            txt.textFill.color = YELLOW
        } else {
            const orig = recallColor(target)
            if (orig) txt.textFill.color = orig
        }
    }
}

/**
 * Wire a pinch activation: use an existing SUIK button (onTriggerUp) if the
 * host has one, otherwise add a collider + Interactable. Lets plain Text
 * elements act as buttons while still honoring real SUIK buttons when present.
 */
export function bindActivate(host: SceneObject, onActivate: () => void): void {
    if (!host) return
    const btn = findButton(host)
    if (btn && btn.onTriggerUp && btn.onTriggerUp.add) {
        btn.onTriggerUp.add(() => onActivate())
        return
    }
    installInteractable(host, onActivate)
}

/** Add a collider + SIK Interactable; pinch release fires onActivate. */
export function installInteractable(target: SceneObject, onActivate: () => void): void {
    try {
        const collider = target.createComponent("Physics.ColliderComponent") as any
        const box = Shape.createBoxShape()
        let sx = 35, sy = 17
        const rmv = findRMV(target)
        if (rmv) {
            const s = rmv.getSceneObject().getTransform().getLocalScale()
            if (s.x > 0) sx = s.x
            if (s.y > 0) sy = s.y
        }
        box.size = new vec3(sx, sy, 1)
        collider.shape = box
        collider.fitVisual = false
        const interactable = target.createComponent(Interactable.getTypeName())
        interactable.onTriggerEnd.add((_e: any) => onActivate())
    } catch (e) {
        print("HighlightRing: installInteractable failed: " + e)
    }
}
