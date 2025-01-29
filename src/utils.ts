import { ScryptedDeviceType, Setting, Thermometer } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

export const deviceFilter = `type === '${ScryptedDeviceType.Thermostat}'`;
export const updateCameraConfigurationRegex = new RegExp('overlay:(.*):update');
export const HIKVISION_UTILITIES_INTERFACE = `HIKVISION_UTILITIES`;

export type SupportedDevice = Thermometer;

interface Overlay {
    text: string;
    isDevice: boolean;
    device: string;
    prefix: string;
}

export const getOverlayKeys = (overlayId: string) => {
    const textKey = `overlay:${overlayId}:text`;
    const enableDeviceKey = `overlay:${overlayId}:useDevice`;
    const prefixKey = `overlay:${overlayId}:prefix`;
    const deviceKey = `overlay:${overlayId}:device`;
    const updateKey = `overlay:${overlayId}:update`;

    return {
        textKey,
        enableDeviceKey,
        prefixKey,
        deviceKey,
        updateKey,
    }
}

export const getOverlaySettings = (props: {
    storage: StorageSettings<any>,
    overlayIds: string[]
}) => {
    const { storage, overlayIds } = props;
    const settings: Setting[] = [];

    for (const overlayId of overlayIds) {
        const overlayName = `Overlay ${overlayId}`;

        const { deviceKey, enableDeviceKey, prefixKey, textKey, updateKey } = getOverlayKeys(overlayId);

        const isDevice = JSON.parse(storage.getItem(enableDeviceKey as any) as string ?? 'false');

        settings.push(
            {
                key: textKey,
                title: 'Text',
                type: 'string',
                subgroup: overlayName,
                value: storage.getItem(textKey),
                readonly: isDevice,
            },
            {
                key: enableDeviceKey,
                title: 'Use device value',
                description: 'Text will depend on the device selected',
                type: 'boolean',
                subgroup: overlayName,
                value: isDevice,
                immediate: true,
            }
        );

        if (isDevice) {
            settings.push(
                {
                    key: deviceKey,
                    title: 'Device',
                    type: 'device',
                    subgroup: overlayName,
                    deviceFilter: deviceFilter,
                    immediate: true,
                    value: storage.getItem(deviceKey)
                },
                {
                    key: prefixKey,
                    title: 'Value prefix',
                    type: 'string',
                    subgroup: overlayName,
                    value: storage.getItem(prefixKey),
                },
            );
        }

        settings.push({
            key: updateKey,
            type: 'button',
            title: 'Update configuration',
            subgroup: overlayName,
        });
    }

    return settings;
}

export const getOverlay = (props: {
    storage: StorageSettings<any>,
    overlayId: string

}) => {
    const { storage, overlayId } = props;

    const { deviceKey, enableDeviceKey, prefixKey, textKey } = getOverlayKeys(overlayId);

    const isDevice = JSON.parse(storage.getItem(enableDeviceKey as any) as string ?? 'false');
    const device = storage.getItem(deviceKey);
    const text = storage.getItem(textKey);
    const prefix = storage.getItem(prefixKey);

    return {
        device,
        isDevice,
        prefix,
        text
    };
}