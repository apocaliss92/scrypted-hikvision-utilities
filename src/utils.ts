import sdk, { EventListenerRegister, HumiditySensor, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Thermometer } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { MotionDetection } from "./types";

export const HIKVISION_UTILITIES_INTERFACE = `HIKVISION_UTILITIES`;

export interface MotionDetectionUpdateParams {
    enabled: boolean;
    motionSensitivity: string;
}
