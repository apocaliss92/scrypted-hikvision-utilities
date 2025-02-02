import { HumiditySensor, ScryptedDeviceBase, ScryptedInterface, Setting, Thermometer } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

export const HIKVISION_UTILITIES_INTERFACE = `HIKVISION_UTILITIES`;
export const deviceFilter = `['${ScryptedInterface.Thermometer}','${ScryptedInterface.HumiditySensor}'].some(elem => interfaces.includes(elem))`;
export const pluginEnabledFilter = `interfaces.includes('${HIKVISION_UTILITIES_INTERFACE}')`;

export type SupportedDevice = ScryptedDeviceBase & (Thermometer | HumiditySensor);
export enum OverlayType {
    Text = 'Text',
    Device = 'Device',
    FaceDetection = 'FaceDetection',
}

interface Overlay {
    text: string;
    type: OverlayType;
    device: string;
    prefix: string;
}

export const getOverlayKeys = (overlayId: string) => {
    const textKey = `overlay:${overlayId}:text`;
    const typeKey = `overlay:${overlayId}:type`;
    const prefixKey = `overlay:${overlayId}:prefix`;
    const deviceKey = `overlay:${overlayId}:device`;

    return {
        textKey,
        typeKey,
        prefixKey,
        deviceKey,
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

        const { deviceKey, typeKey, prefixKey, textKey } = getOverlayKeys(overlayId);

        const type = storage.getItem(typeKey) ?? OverlayType.Text;

        settings.push(
            {
                key: textKey,
                title: 'Text',
                type: 'string',
                subgroup: overlayName,
                value: storage.getItem(textKey),
                readonly: type !== OverlayType.Text,
            },
            {
                key: typeKey,
                title: 'Overlay type',
                type: 'string',
                choices: [OverlayType.Text, OverlayType.Device, OverlayType.FaceDetection],
                subgroup: overlayName,
                value: type,
                immediate: true,
            }
        );

        const prefixSetting: Setting = {
            key: prefixKey,
            title: 'Value prefix',
            type: 'string',
            subgroup: overlayName,
            value: storage.getItem(prefixKey),
        };

        if (type === OverlayType.Device) {
            settings.push(
                {
                    key: deviceKey,
                    title: 'Device',
                    type: 'device',
                    subgroup: overlayName,
                    deviceFilter,
                    immediate: true,
                    value: storage.getItem(deviceKey)
                },
                prefixSetting
            );
        } else if (type === OverlayType.FaceDetection) {
            settings.push(prefixSetting);
        }
    }

    return settings;
}

export const getOverlay = (props: {
    storage: StorageSettings<any>,
    overlayId: string
}): Overlay => {
    const { storage, overlayId } = props;

    const { deviceKey, typeKey, prefixKey, textKey } = getOverlayKeys(overlayId);

    const type = storage.getItem(typeKey) ?? OverlayType.Text;
    const device = storage.getItem(deviceKey);
    const text = storage.getItem(textKey);
    const prefix = storage.getItem(prefixKey);

    return {
        device,
        type,
        prefix,
        text
    };
}