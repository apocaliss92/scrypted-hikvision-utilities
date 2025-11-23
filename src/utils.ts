import sdk, { EventListenerRegister, HumiditySensor, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Thermometer } from "@scrypted/sdk";
import { StorageSetting, StorageSettings, StorageSettingsDevice, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { MotionDetection } from "./types";

export const HIKVISION_UTILITIES_INTERFACE = `HIKVISION_UTILITIES`;

export interface MotionDetectionUpdateParams {
    enabled: boolean;
    motionSensitivity: string;
}

export interface StreamingChannelUpdateParams {
    channelId?: string;
    videoCodecType?: string;
    videoResolutionWidth?: number;
    videoResolutionHeight?: number;
    maxFrameRate?: number;
    vbrUpperCap?: number;
    constantBitRate?: number;
    audioCompressionType?: string;
    govLength?: number;
    fixedQuality?: number;
    videoQualityControlType?: 'VBR' | 'CBR';
    smoothing?: number;
    H264Profile?: string;
    H265Profile?: string;
    audioEnabled?: boolean;
    smartCodecEnabled?: boolean;
}

/**
 * Converts frame rate from centesimal format (e.g., 2500 = 25fps) to human-readable format
 * @param frameRate Frame rate in centesimal format (e.g., 2500, 1000, 50, 6)
 * @returns Human-readable string (e.g., "25", "10", "1/2", "1/16")
 */
export function formatFrameRate(frameRate: number): string {
    if (frameRate >= 100) {
        // Standard fps (100+ = 1fps or more)
        return String(frameRate / 100);
    } else {
        // Fractional fps (less than 1fps)
        const denominator = Math.round(100 / frameRate);
        return `1/${denominator}`;
    }
}

/**
 * Converts human-readable frame rate back to centesimal format
 * @param formattedFps Human-readable frame rate (e.g., "25", "10", "1/2", "1/16")
 * @returns Frame rate in centesimal format
 */
export function parseFrameRate(formattedFps: string): number {
    if (formattedFps.includes('/')) {
        // Fractional format like "1/2"
        const [numerator, denominator] = formattedFps.split('/').map(Number);
        return Math.round((numerator / denominator) * 100);
    } else {
        // Standard format like "25"
        return Number(formattedFps) * 100;
    }
}

/**
 * Converts GOP length (in frames) to seconds based on frame rate
 * @param govLength GOP length in frames (e.g., 100 frames)
 * @param maxFrameRate Frame rate in centesimal format (e.g., 2500 = 25fps)
 * @returns GOP length in seconds for UI display (e.g., 4 seconds)
 */
export function formatKeyFrameInterval(govLength: number, maxFrameRate: number): number {
    // Convert frame rate from centesimal to fps
    const fps = maxFrameRate / 100;
    
    // Calculate seconds: govLength frames / fps
    return Math.round(govLength / fps);
}

/**
 * Converts GOP length from UI format (seconds) back to API format (frames)
 * @param uiValue GOP length from UI in seconds (e.g., 4)
 * @param maxFrameRate Frame rate in centesimal format (e.g., 2500 = 25fps)
 * @returns GOP length in frames (e.g., 100)
 */
export function parseKeyFrameInterval(uiValue: number, maxFrameRate: number): number {
    // Convert frame rate from centesimal to fps
    const fps = maxFrameRate / 100;
    
    // Calculate frames: seconds * fps
    return Math.round(uiValue * fps);
}

export const generateBitrateChoices = (min: number, max: number): string[] => {
    const choices: string[] = [];

    // Standard bitrate values (powers of 2 and multiples)
    const standardValues = [
        32, 64, 128, 256, 512, 768, 1024, 1536, 2048, 3072, 4096,
        6144, 8192, 12288, 16384, 20480, 24576, 32768
    ];

    // Filter values within min/max range
    for (const value of standardValues) {
        if (value >= min && value <= max) {
            choices.push(String(value));
        }
    }

    // Ensure min is included if not in standard values
    if (!choices.includes(String(min))) {
        choices.unshift(String(min));
    }

    // Ensure max is included if not in standard values
    if (!choices.includes(String(max))) {
        choices.push(String(max));
    }

    return choices;
}

export const convertSettingsToStorageSettings = async (props: {
    device: StorageSettingsDevice,
    dynamicSettings: StorageSetting[],
    initStorage: StorageSettingsDict<string>,
}) => {
    const { device, dynamicSettings, initStorage } = props;

    const onPutToRestore: Record<string, any> = {};
    Object.entries(initStorage).forEach(([key, setting]) => {
        if (setting.onPut) {
            onPutToRestore[key] = setting.onPut;
        }
    });

    const settings: StorageSetting[] = await new StorageSettings(device, initStorage).getSettings();

    settings.push(...dynamicSettings);

    const deviceSettings: StorageSettingsDict<string> = {};

    for (const setting of settings) {
        const { value, key, onPut, ...rest } = setting;
        deviceSettings[key] = {
            ...rest,
            value: rest.type === 'html' ? value : undefined
        };
        if (setting.onPut) {
            deviceSettings[key].onPut = setting.onPut.bind(device)
        }
    }

    const updateStorageSettings = new StorageSettings(device, deviceSettings);

    Object.entries(onPutToRestore).forEach(([key, onPut]) => {
        updateStorageSettings.settings[key].onPut = onPut;
    });

    return updateStorageSettings;
}