// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

/**
 * InteractableProbe — diagnostic. Subscribes to a SIK Interactable on the
 * same SceneObject and prints when interaction events fire. Lets you see in
 * the Logger whether hover/trigger reach a given location in the scene.
 *
 * Add this script alongside an Interactable component on a SceneObject inside
 * the ScrollView's content. If you see prints when you point/pinch at it on
 * Spectacles (or click in Preview), input is reaching that level and any
 * unresponsive sibling component (e.g. ScrollView) is the bug. If you see
 * nothing, input is being intercepted upstream.
 */
@component
export class InteractableProbe extends BaseScriptComponent {

    @input
    @hint("SIK Interactable component on this same SceneObject")
    interactable: any

    @input
    @hint("A label to identify this probe in the Logger output")
    label: string = "probe"

    onAwake() {
        this.createEvent("OnStartEvent").bind(() => this.init())
    }

    private init() {
        if (!this.interactable) {
            print("[" + this.label + "] InteractableProbe: no interactable wired")
            return
        }

        const ev = this.interactable

        if (ev.onHoverEnter) ev.onHoverEnter.add(() => print("[" + this.label + "] hover enter"))
        if (ev.onHoverExit) ev.onHoverExit.add(() => print("[" + this.label + "] hover exit"))
        if (ev.onTriggerStart) ev.onTriggerStart.add(() => print("[" + this.label + "] trigger start"))
        if (ev.onTriggerEnd) ev.onTriggerEnd.add(() => print("[" + this.label + "] trigger end"))
        if (ev.onTriggerUpdate) ev.onTriggerUpdate.add(() => print("[" + this.label + "] trigger update"))

        print("[" + this.label + "] InteractableProbe: subscribed")
    }
}
