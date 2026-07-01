// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

import {BleKeyboard, KeypressData} from "./BleKeyboard"


@component
export class BleKeyboardAdapter extends BaseScriptComponent {

    @input
    bleKeyboard: BleKeyboard

    @ui.separator

    @input
    connectedBluetoothObj: SceneObject

    @input
    scanningBluetoothObj: SceneObject

    @input
    keyboardNameText: Text

    @ui.separator

    @input
    @hint("Text component to display typed keypresses")
    chatWindowText: Text

    @ui.separator

    @input
    @hint("Displays total keypress count")
    keypressCountText: Text

    @input
    @hint("Displays words per minute")
    wpmText: Text

    @input
    @hint("Displays word count")
    wordCountText: Text

    @input
    @hint("Displays battery level percentage")
    batteryLevelText: Text

    @ui.separator

    @input
    @hint("AudioComponent that plays the typewriter keypress sound")
    keypressAudio: AudioComponent

    @input
    @allowUndefined
    @hint("Optional: Toggle button to enable/disable keypress audio")
    audioToggle: any

    private audioEnabled: boolean = true;
    private chatContent: string = "";
    private maxChatLines: number = 20;
    private maxLineLength: number = 40;
    private keypressCount: number = 0;
    private typingStartTime: number = 0;

    onAwake() {
        if (!this.bleKeyboard || !this.bleKeyboard.onDeviceConnected) {
            // BleKeyboard not ready yet — defer to next frame
            this.createEvent("OnStartEvent").bind(() => {
                this.init();
            });
        } else {
            this.init();
        }
    }

    private init() {
        this.bleKeyboard.onDeviceConnected.add(this.onDeviceConnected.bind(this));
        this.bleKeyboard.onKeypress.add(this.onKeypress.bind(this));
        this.bleKeyboard.onBatteryLevel.add(this.onBatteryLevel.bind(this));

        if (this.chatWindowText) {
            this.chatWindowText.text = "Waiting for keyboard...";
        }
        if (this.batteryLevelText) {
            this.batteryLevelText.text = "--";
        }

        // Listen for audio toggle changes
        if (this.audioToggle && this.audioToggle.onStateChanged) {
            this.audioToggle.onStateChanged.add((isOn: boolean) => {
                this.audioEnabled = isOn;
                print("Audio " + (isOn ? "enabled" : "disabled"));
            });
        }
    }

    private onDeviceConnected(keyboardName: string) {
        this.scanningBluetoothObj.enabled = false;
        this.connectedBluetoothObj.enabled = true;
        this.keyboardNameText.text = keyboardName;

        this.chatContent = "";
        this.keypressCount = 0;
        this.typingStartTime = 0;
        this.updateChatDisplay();
        this.updateStats();
    }

    private onKeypress(data: KeypressData) {
        const key = data.key;

        if (key === "BACKSPACE") {
            if (this.chatContent.length > 0) {
                this.chatContent = this.chatContent.slice(0, -1);
            }
        } else if (key === "ESC") {
            // Ignore ESC
        } else if (key.startsWith("[0x")) {
            // Unknown key code, ignore
        } else {
            this.chatContent += key;
        }

        this.keypressCount++;
        if (this.typingStartTime === 0) {
            this.typingStartTime = Date.now();
        }

        this.playKeypressSound();
        this.updateChatDisplay();
        this.updateStats();
    }

    private updateChatDisplay() {
        if (!this.chatWindowText) return;

        const lines = this.wrapText(this.chatContent, this.maxLineLength);
        const visibleLines = lines.slice(-this.maxChatLines);
        const display = visibleLines.join("\n") + "_";

        this.chatWindowText.text = display;
    }

    private updateStats() {
        if (this.keypressCountText) {
            this.keypressCountText.text = this.keypressCount.toString();
        }

        const wordCount = this.getWordCount();
        if (this.wordCountText) {
            this.wordCountText.text = wordCount.toString();
        }

        if (this.wpmText) {
            if (this.typingStartTime > 0 && wordCount > 0) {
                const elapsedMs = Date.now() - this.typingStartTime;
                const elapsedMin = elapsedMs / 60000;
                const wpm = elapsedMin > 0 ? Math.round(wordCount / elapsedMin) : 0;
                this.wpmText.text = wpm.toString();
            } else {
                this.wpmText.text = "0";
            }
        }
    }

    private playKeypressSound() {
        if (this.audioEnabled && this.keypressAudio) {
            this.keypressAudio.stop(false);
            this.keypressAudio.play(1);
        }
    }

    private onBatteryLevel(level: number) {
        print("BleKeyboardAdapter: battery level received: " + level + "%");
        if (this.batteryLevelText) {
            this.batteryLevelText.text = level + "%";
        } else {
            print("BleKeyboardAdapter: batteryLevelText not wired!");
        }
    }

    private getWordCount(): number {
        const trimmed = this.chatContent.trim();
        if (trimmed.length === 0) return 0;
        return trimmed.split(/\s+/).length;
    }

    private wrapText(text: string, maxWidth: number): string[] {
        const result: string[] = [];
        const rawLines = text.split("\n");

        for (const rawLine of rawLines) {
            if (rawLine.length === 0) {
                result.push("");
                continue;
            }
            let remaining = rawLine;
            while (remaining.length > maxWidth) {
                let breakAt = remaining.lastIndexOf(" ", maxWidth);
                if (breakAt <= 0) breakAt = maxWidth;
                result.push(remaining.slice(0, breakAt));
                remaining = remaining.slice(breakAt).trimStart();
            }
            result.push(remaining);
        }

        return result.length === 0 ? [""] : result;
    }
}
