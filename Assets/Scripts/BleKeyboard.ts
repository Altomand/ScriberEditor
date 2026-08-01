// Copyright (c) 2026 Arthur Ibanda
// Licensed under the MIT License. See LICENSE.md in the project root.

import Event from "./Event"
import {SelectionData, CommitData, Section, commitToKeyString} from "./KeyboardLayout"

// USB HID Usage Table for Keyboard/Keypad
const HID_KEY_MAP: Record<number, string> = {
    0x04: "a", 0x05: "b", 0x06: "c", 0x07: "d", 0x08: "e",
    0x09: "f", 0x0A: "g", 0x0B: "h", 0x0C: "i", 0x0D: "j",
    0x0E: "k", 0x0F: "l", 0x10: "m", 0x11: "n", 0x12: "o",
    0x13: "p", 0x14: "q", 0x15: "r", 0x16: "s", 0x17: "t",
    0x18: "u", 0x19: "v", 0x1A: "w", 0x1B: "x", 0x1C: "y",
    0x1D: "z",
    0x1E: "1", 0x1F: "2", 0x20: "3", 0x21: "4", 0x22: "5",
    0x23: "6", 0x24: "7", 0x25: "8", 0x26: "9", 0x27: "0",
    0x28: "\n",  // Enter
    0x29: "ESC",
    0x2A: "BACKSPACE",
    0x2B: "\t",  // Tab
    0x2C: " ",   // Space
    0x2D: "-", 0x2E: "=", 0x2F: "[", 0x30: "]", 0x31: "\\",
    0x33: ";", 0x34: "'", 0x35: "`", 0x36: ",", 0x37: ".",
    0x38: "/",
};

const HID_KEY_MAP_SHIFTED: Record<number, string> = {
    0x04: "A", 0x05: "B", 0x06: "C", 0x07: "D", 0x08: "E",
    0x09: "F", 0x0A: "G", 0x0B: "H", 0x0C: "I", 0x0D: "J",
    0x0E: "K", 0x0F: "L", 0x10: "M", 0x11: "N", 0x12: "O",
    0x13: "P", 0x14: "Q", 0x15: "R", 0x16: "S", 0x17: "T",
    0x18: "U", 0x19: "V", 0x1A: "W", 0x1B: "X", 0x1C: "Y",
    0x1D: "Z",
    0x1E: "!", 0x1F: "@", 0x20: "#", 0x21: "$", 0x22: "%",
    0x23: "^", 0x24: "&", 0x25: "*", 0x26: "(", 0x27: ")",
    0x2D: "_", 0x2E: "+", 0x2F: "{", 0x30: "}", 0x31: "|",
    0x33: ":", 0x34: "\"", 0x35: "~", 0x36: "<", 0x37: ">",
    0x38: "?",
};

// Custom Scriber Keyboard Service (see the Scriber controller's GATT protocol).
// Streams live selection state + key commits; open (no encryption / pairing).
const SCRIBER_SERVICE_UUIDS = ["73637269-6265-7200-0000-000000000000"];
const SCRIBER_STATE_UUIDS = ["73637269-6265-7200-0000-000000000001"];
const SCRIBER_COMMIT_UUIDS = ["73637269-6265-7200-0000-000000000002"];

// Decode helpers (pure) — shared by the BLE notify path and the simulator.
export function decodeState(data: Uint8Array): SelectionData {
    return {
        section: (data[0] as Section),
        row: data[1],
        shiftPending: (data[2] & 0x01) !== 0,
        capsLock: (data[2] & 0x02) !== 0,
        heldButtons: data[3],
    };
}

export function decodeCommit(data: Uint8Array): CommitData {
    return {
        section: (data[0] as Section),
        row: data[1],
        button: data[2],
        action: data[3],
        shifted: data[4] !== 0,
        payload: data[5],
        seq: data[6],
    };
}

// BLE HID Service and Characteristic UUIDs (short and long forms)
const HID_SERVICE_UUIDS = ["0x1812", "00001812-0000-1000-8000-00805f9b34fb"];
const HID_REPORT_UUIDS = ["0x2A4D", "0x2a4d", "00002a4d-0000-1000-8000-00805f9b34fb"];
const BATTERY_SERVICE_UUIDS = ["0x180F", "0x180f", "0000180f-0000-1000-8000-00805f9b34fb"];
const BATTERY_LEVEL_UUIDS = ["0x2A19", "0x2a19", "00002a19-0000-1000-8000-00805f9b34fb"];

export class KeypressData {
    public key: string;
    public isShifted: boolean;
    public rawKeyCode: number;
    public modifiers: number;
}

class KeyboardDevice {
    public name: string;
    public address: any;
    private bluetoothModule: Bluetooth.BluetoothCentralModule;
    private gatt;
    private previousKeys: number[] = [];
    private eventListeners: { keypress: Function[], battery: Function[], selection: Function[], commit: Function[] };

    constructor(name: string, address: any, bluetoothModule: Bluetooth.BluetoothCentralModule) {
        this.name = name;
        this.address = address;
        this.bluetoothModule = bluetoothModule;
        this.gatt = null;
        this.eventListeners = { keypress: [], battery: [], selection: [], commit: [] };
    }

    async connect(onConnect: Function, onDisconnect: Function) {
        try {
            print("KeyboardDevice: connecting to " + this.name + "...");
            this.gatt = await this.bluetoothModule.connectGatt(this.address);
            print("KeyboardDevice: GATT connected.");

            this.gatt.onConnectionStateChangedEvent.add((event) => {
                if (event.state === 0) {
                    if (onDisconnect) {
                        try {
                            onDisconnect(event);
                        } catch (error) {
                            print("Error in onDisconnect callback:" + error);
                        }
                    }
                }
            });

            await this.requestMtu();
            await this.requestBond();

            // Prefer the custom Scriber service (cross keyboard). Fall back to
            // standard HID for the M5/legacy keyboards.
            const usedScriber = await this.discoverScriberService();
            if (!usedScriber) {
                await this.discoverHidService();
            }

            print("KeyboardDevice: ready (" + (usedScriber ? "Scriber" : "HID") + ").");

            // Wire up event listeners before battery discovery so they receive the initial read
            if (onConnect) {
                try {
                    onConnect(this);
                } catch (error) {
                    print("Error in onConnect callback:" + error);
                }
            }

            // Battery discovery after onConnect so listeners are wired
            await this.discoverBatteryService();
        } catch (error) {
            print("KeyboardDevice: connect failed: " + error);
            throw error;
        }
    }

    public addEventListener(type: string, callback: Function) {
        if (this.eventListeners[type]) {
            this.eventListeners[type].push(callback);
        }
    }

    private emit(type: string, data: any) {
        for (const cb of this.eventListeners[type] || []) {
            cb(data);
        }
    }

    private async requestMtu() {
        try {
            await this.gatt.requestMtu(512);
        } catch (e) {
            print("MTU request failed, continuing with default.");
        }
    }

    private async requestBond() {
        try {
            if (this.gatt.createBond) {
                print("KeyboardDevice: requesting bond...");
                await this.gatt.createBond();
                print("KeyboardDevice: bonded.");
            } else {
                print("KeyboardDevice: createBond not available.");
            }
        } catch (e) {
            print("KeyboardDevice: bond failed (" + e + "), continuing.");
        }
    }

    private uuidMatches(uuid: string, candidates: string[]): boolean {
        const lower = uuid.toLowerCase();
        for (const c of candidates) {
            if (lower === c.toLowerCase()) return true;
        }
        return false;
    }

    private async discoverHidService() {
        const services = this.gatt.getServices();

        const hidService = services.find(s => this.uuidMatches(s.uuid, HID_SERVICE_UUIDS));
        if (!hidService) {
            const available = services.map(s => s.uuid || "(empty)").join(", ");
            throw new Error("HID service (0x1812) not found. Available: " + available);
        }

        print("KeyboardDevice: found HID service.");
        const characteristics = hidService.getCharacteristics();

        const reportChars = characteristics.filter(c => this.uuidMatches(c.uuid, HID_REPORT_UUIDS));
        if (reportChars.length === 0) {
            const available = characteristics.map(c => c.uuid || "(empty)").join(", ");
            throw new Error("No HID Report characteristics (0x2A4D) found. Available: " + available);
        }

        print("KeyboardDevice: found " + reportChars.length + " report characteristic(s).");

        // Set Protocol Mode to Report Protocol (0x01) before subscribing
        const protocolModeChar = characteristics.find(c =>
            c.uuid === "0x2A4E" || c.uuid.toLowerCase() === "00002a4e-0000-1000-8000-00805f9b34fb");
        if (protocolModeChar) {
            try {
                await protocolModeChar.writeValue(new Uint8Array([0x01]));
                print("KeyboardDevice: Protocol Mode set.");
            } catch (e) {
                print("KeyboardDevice: Protocol Mode write failed: " + e);
            }
        }

        // Subscribe to report notifications
        let subscribed = 0;
        for (let i = 0; i < reportChars.length; i++) {
            try {
                await reportChars[i].registerNotifications((value: Uint8Array) => {
                    this.handleReport(value);
                });
                subscribed++;
                print("KeyboardDevice: subscribed to report char " + i + ".");
            } catch (e) {
                print("KeyboardDevice: subscribe failed on report char " + i + ": " + e);
            }
        }

        if (subscribed === 0) {
            throw new Error("Could not subscribe to any HID Report characteristic.");
        }
    }

    // Returns true if the Scriber custom service was found and subscribed.
    private async discoverScriberService(): Promise<boolean> {
        const services = this.gatt.getServices();
        const svc = services.find(s => this.uuidMatches(s.uuid, SCRIBER_SERVICE_UUIDS));
        if (!svc) {
            return false;
        }
        print("KeyboardDevice: found Scriber service.");
        const chars = svc.getCharacteristics();

        const stateChar = chars.find(c => this.uuidMatches(c.uuid, SCRIBER_STATE_UUIDS));
        const commitChar = chars.find(c => this.uuidMatches(c.uuid, SCRIBER_COMMIT_UUIDS));
        if (!stateChar || !commitChar) {
            const available = chars.map(c => c.uuid || "(empty)").join(", ");
            throw new Error("Scriber service missing state/commit chars. Available: " + available);
        }

        await stateChar.registerNotifications((value: Uint8Array) => {
            if (value.length >= 4) {
                this.emit("selection", decodeState(value));
            }
        });
        await commitChar.registerNotifications((value: Uint8Array) => {
            if (value.length >= 7) {
                this.handleCommit(decodeCommit(value));
            }
        });
        print("KeyboardDevice: subscribed to Scriber state + commit.");
        return true;
    }

    // A commit drives both the visual key flash (via "commit") and the text
    // buffer (via "keypress", reusing the existing JournalController path).
    private handleCommit(c: CommitData) {
        this.emit("commit", c);
        const key = commitToKeyString(c);
        if (key !== "") {
            const kp = new KeypressData();
            kp.key = key;
            kp.isShifted = c.shifted;
            kp.rawKeyCode = c.payload;
            kp.modifiers = 0;
            this.emit("keypress", kp);
        }
    }

    private async discoverBatteryService() {
        try {
            const services = this.gatt.getServices();
            const batteryService = services.find(s => this.uuidMatches(s.uuid, BATTERY_SERVICE_UUIDS));
            if (!batteryService) {
                print("KeyboardDevice: no battery service found.");
                return;
            }

            const chars = batteryService.getCharacteristics();
            const batteryChar = chars.find(c => this.uuidMatches(c.uuid, BATTERY_LEVEL_UUIDS));
            if (!batteryChar) {
                print("KeyboardDevice: no battery level characteristic found.");
                return;
            }

            // Read initial battery level
            try {
                print("KeyboardDevice: reading battery level...");
                const val = await batteryChar.readValue();
                print("KeyboardDevice: battery readValue returned: " + (val ? "length=" + val.length : "null"));
                if (val && val.length > 0) {
                    const level = val[0];
                    print("KeyboardDevice: battery level " + level + "%");
                    this.emit("battery", level);
                } else {
                    print("KeyboardDevice: battery read returned empty.");
                }
            } catch (e) {
                print("KeyboardDevice: battery read failed: " + e);
            }

            // Subscribe to battery level notifications
            try {
                await batteryChar.registerNotifications((value: Uint8Array) => {
                    print("KeyboardDevice: battery notification: " + (value.length > 0 ? value[0] + "%" : "empty"));
                    if (value.length > 0) {
                        this.emit("battery", value[0]);
                    }
                });
                print("KeyboardDevice: subscribed to battery notifications.");
            } catch (e) {
                print("KeyboardDevice: battery subscribe failed: " + e);
            }
        } catch (e) {
            print("KeyboardDevice: battery service error: " + e);
        }
    }

    private handleReport(data: Uint8Array) {
        if (data.length === 8) {
            this.parseKeyboardReport(data);
        }
    }

    private parseKeyboardReport(data: Uint8Array) {
        const modifiers = data[0];
        const isShifted = (modifiers & 0x22) !== 0;

        const currentKeys: number[] = [];
        for (let i = 2; i < 8; i++) {
            if (data[i] !== 0x00 && data[i] !== 0x01) {
                currentKeys.push(data[i]);
            }
        }

        for (const keyCode of currentKeys) {
            if (this.previousKeys.indexOf(keyCode) === -1) {
                const keyMap = isShifted ? HID_KEY_MAP_SHIFTED : HID_KEY_MAP;
                const key = keyMap[keyCode] || "[0x" + keyCode.toString(16) + "]";

                const keypressData = new KeypressData();
                keypressData.key = key;
                keypressData.isShifted = isShifted;
                keypressData.rawKeyCode = keyCode;
                keypressData.modifiers = modifiers;

                this.emit("keypress", keypressData);
            }
        }

        this.previousKeys = currentKeys;
    }
}


class KeyboardScanner {
    private bluetoothModule: Bluetooth.BluetoothCentralModule;
    private isScanning: boolean;
    private deviceName: string;
    private targetAddress: string;

    constructor(bluetoothModule: Bluetooth.BluetoothCentralModule, deviceName: string, targetAddress: string) {
        this.bluetoothModule = bluetoothModule;
        this.isScanning = false;
        this.deviceName = deviceName;
        this.targetAddress = targetAddress;
    }

    public start(onDeviceFound: Function) {
        if (this.isScanning) return;

        this.isScanning = true;
        const matchName = this.deviceName || "Skywriter";
        print("Scanning for '" + matchName + "'...");

        // The Bluetooth API is experimental: available in dev runs (preview /
        // Send to Spectacles with Experimental API on) but NOT in published
        // lenses — where the `Bluetooth` namespace can still EXIST with its
        // members stripped, so checking the namespace alone is not enough.
        // Degrade gracefully in every failure mode: the tap keyboard and
        // cloud features work without the Scriber controller.
        const btAny: any = (typeof Bluetooth !== "undefined") ? Bluetooth : null;
        if (!btAny || typeof btAny.ScanFilter !== "function"
            || typeof btAny.ScanSettings !== "function" || !this.bluetoothModule) {
            this.isScanning = false;
            print("BleKeyboard: Bluetooth API unavailable (published build or module unwired). Running without the Scriber controller — tap-to-type still works.");
            return;
        }

        try {
            const scanFilter = new Bluetooth.ScanFilter();
            const scanSettings = new Bluetooth.ScanSettings();
            scanSettings.timeoutSeconds = 30;
            scanSettings.scanMode = Bluetooth.ScanMode.LowPower;

            this.bluetoothModule.startScan(
                [scanFilter],
                scanSettings,
                (result) => {
                    const name = result.deviceName || "";
                    if (name === "") return;

                    if (this.targetAddress) {
                        const addr = result.deviceAddress ? result.deviceAddress.toString() : "";
                        if (addr === this.targetAddress) {
                            print("Keyboard matched by address.");
                            this.stop();
                            onDeviceFound(new KeyboardDevice(name, result.deviceAddress, this.bluetoothModule));
                        }
                        return;
                    }

                    if (name === matchName) {
                        print("Keyboard found: '" + name + "'");
                        this.stop();
                        onDeviceFound(new KeyboardDevice(name, result.deviceAddress, this.bluetoothModule));
                    }
                });
        } catch (e) {
            this.isScanning = false;
            print("BleKeyboard: Bluetooth scan failed (" + e + "). Running without the Scriber controller — tap-to-type still works.");
        }
    }

    public stop() {
        if (!this.isScanning) return;
        try {
            this.bluetoothModule.stopScan();
        } catch (e) {
            print("BleKeyboard: stopScan failed: " + e);
        }
        this.isScanning = false;
    }
}


@component
export class BleKeyboard extends BaseScriptComponent {

    @input
    bluetoothCentralModule: Bluetooth.BluetoothCentralModule;

    @input
    @hint("BLE device name to scan for")
    keyboardName: string = "Skywriter";

    @input
    @hint("Optional: BLE address override (comma-separated decimal bytes)")
    keyboardAddress: string = "";

    private scanner: KeyboardScanner;
    private isConnecting: boolean = false;

    private onDeviceConnectedEvent = new Event<string>()
    private onKeypressEvent = new Event<KeypressData>()
    private onBatteryLevelEvent = new Event<number>()
    private onSelectionChangedEvent = new Event<SelectionData>()
    private onCommitEvent = new Event<CommitData>()

    public onDeviceConnected = this.onDeviceConnectedEvent.publicApi()
    public onKeypress = this.onKeypressEvent.publicApi()
    public onBatteryLevel = this.onBatteryLevelEvent.publicApi()
    // Scriber cross-keyboard: live selection state + key commits for highlighting.
    public onSelectionChanged = this.onSelectionChangedEvent.publicApi()
    public onCommit = this.onCommitEvent.publicApi()

    onAwake() {
        this.startScanning();
    }

    private startScanning() {
        this.scanner = new KeyboardScanner(
            this.bluetoothCentralModule,
            this.keyboardName,
            this.keyboardAddress
        );
        this.scanner.start((device: KeyboardDevice) => {
            this.connectToDevice(device);
        });
    }

    private async connectToDevice(device: KeyboardDevice) {
        if (this.isConnecting) return;
        this.isConnecting = true;

        const onConnect = (connectedDevice: KeyboardDevice) => {
            this.onDeviceConnectedEvent.invoke(connectedDevice.name);
            connectedDevice.addEventListener("keypress", (data: KeypressData) => {
                this.onKeypressEvent.invoke(data);
            });
            connectedDevice.addEventListener("battery", (level: number) => {
                this.onBatteryLevelEvent.invoke(level);
            });
            connectedDevice.addEventListener("selection", (data: SelectionData) => {
                this.onSelectionChangedEvent.invoke(data);
            });
            connectedDevice.addEventListener("commit", (data: CommitData) => {
                this.onCommitEvent.invoke(data);
            });
        };

        const onDisconnect = () => {
            print("Keyboard disconnected. Rescanning...");
            this.isConnecting = false;
            this.startScanning();
        };

        try {
            await device.connect(onConnect, onDisconnect);
        } catch (error) {
            print("Connection error: " + error);
            this.isConnecting = false;
            this.startScanning();
        }
    }

    // --- Simulator hooks (preview testing without hardware) ---
    // Feed raw 4-byte state / 8-byte commit packets exactly as the firmware would.
    public injectStateBytes(data: Uint8Array) {
        if (data.length >= 4) {
            this.onSelectionChangedEvent.invoke(decodeState(data));
        }
    }

    public injectCommitBytes(data: Uint8Array) {
        if (data.length < 7) return;
        const c = decodeCommit(data);
        this.onCommitEvent.invoke(c);
        const key = commitToKeyString(c);
        if (key !== "") {
            const kp = new KeypressData();
            kp.key = key;
            kp.isShifted = c.shifted;
            kp.rawKeyCode = c.payload;
            kp.modifiers = 0;
            this.onKeypressEvent.invoke(kp);
        }
    }
}
