import sdk, { EventListenerRegister, ObjectsDetected, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import HikvisionVideoclipssProvider from "./main";
import { HikvisionCameraAPI } from "./client";
import { getOverlayKeys, getOverlay, getOverlaySettings, SupportedDevice, pluginEnabledFilter, OverlayType } from "./utils";

enum ListenerType {
    Face = 'Face',
    Humidity = 'Humidity',
    Temperature = 'Temperature',
}

export default class HikvisionUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    client: HikvisionCameraAPI;
    killed: boolean;
    overlayIds: string[] = [];
    listenersMap: Record<string, { listenerType: ListenerType, listener: EventListenerRegister, device?: string }> = {};
    checkInterval: NodeJS.Timeout;

    storageSettings = new StorageSettings(this, {
        getCurrentOverlayConfigurations: {
            title: 'Get current overlay configurations',
            type: 'button',
        },
        duplicateFromDevice: {
            title: 'Duplicate from device',
            description: 'Duplicate OSD information from another devices enabled on the plugin',
            type: 'device',
            deviceFilter: pluginEnabledFilter,
            immediate: true,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: HikvisionVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    removeListeners() {
        try {
            Object.values(this.listenersMap).forEach(({ listener }) => listener && listener.removeListener());
            this.checkInterval && clearInterval(this.checkInterval);
            this.checkInterval = undefined;
        } catch (e) {
            this.console.error('Error in removeListeners', e);
        }
    }

    async release() {
        this.killed = true;
        this.removeListeners();
    }

    async getDeviceProperties() {
        const deviceSettings = await this.mixinDevice.getSettings();

        const deviceSettingsMap = keyBy(deviceSettings, setting => setting.key);
        const username = deviceSettingsMap['username']?.value;
        const password = deviceSettingsMap['password']?.value;
        const host = deviceSettingsMap['ip']?.value;
        const httpPort = deviceSettingsMap['httpPort']?.value || 80;
        const channel = deviceSettingsMap['rtspChannel']?.value ?? '101';
        const httpAddress = `${host}:${httpPort}`;

        return { username, password, httpAddress, channel, host }
    }

    async getClient() {
        if (!this.client) {
            const { channel, httpAddress, username, password } = await this.getDeviceProperties();
            this.client = new HikvisionCameraAPI(
                httpAddress,
                username,
                password,
                channel,
                this.console
            );
        }
        return this.client;
    }

    async getMixinSettings(): Promise<Setting[]> {
        const settings = await this.storageSettings.getSettings();

        settings.push(...getOverlaySettings({ storage: this.storageSettings, overlayIds: this.overlayIds }));

        return settings;
    }

    async putMixinSetting(key: string, value: string) {
        if (key === 'getCurrentOverlayConfigurations') {
            await this.getOverlayData();
        } else if (key === 'duplicateFromDevice') {
            await this.duplicateFromDevice(value);
        } else {
            this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }

    async getOverlayData() {
        try {
            const client = await this.getClient();
            const { json: currentOverlay } = await client.getOverlay();
            const overlayIds: string[] = [];

            const overlayEntries = currentOverlay.VideoOverlay.TextOverlayList?.[0]?.TextOverlay;
            for (const overlayEntry of overlayEntries) {
                const id = overlayEntry.id?.[0];
                overlayIds.push(id);
                const { textKey } = getOverlayKeys(id);
                this.storageSettings.putSetting(textKey, overlayEntry.displayText?.[0]);
            }

            this.overlayIds = overlayIds;
        } catch (e) {
            this.console.error('Error inr getOverlayData', e);
        }
    }

    async duplicateFromDevice(deviceId: string) {
        try {
            const deviceToDuplicate = this.plugin.mixinsMap[deviceId];

            if (deviceToDuplicate) {
                const duplicateClient = await deviceToDuplicate.getClient();
                const { json: json } = await duplicateClient.getOverlay();

                const client = await this.getClient();
                await client.updateOverlay(json);
                await this.getOverlayData();

                for (const overlayId of deviceToDuplicate.overlayIds) {
                    const { device, type, prefix, text } = getOverlay({ overlayId, storage: deviceToDuplicate.storageSettings });
                    const { deviceKey, typeKey, prefixKey, textKey } = getOverlayKeys(overlayId);

                    await this.putMixinSetting(deviceKey, device);
                    await this.putMixinSetting(typeKey, type);
                    await this.putMixinSetting(prefixKey, prefix);
                    await this.putMixinSetting(textKey, text);
                }
            }
        } catch (e) {
            this.console.error(`Error in duplicateFromDevice`, e);
        }
    }

    async updateOverlayData(props: {
        overlayId: string,
        listenerType: ListenerType,
        listenInterface: ScryptedInterface,
        data?: any,
        device: ScryptedDeviceBase
    }) {
        const { overlayId, listenerType, data, device } = props;
        this.console.log(`Update received from device ${device.name} ${JSON.stringify({
            overlayId,
            listenerType,
            data
        })}`);

        try {
            const client = await this.getClient();
            const { json: currentContent } = await client.getOverlayText(overlayId);

            const { device, prefix, text } = getOverlay({ overlayId, storage: this.storageSettings });
            const realDevice = device ? sdk.systemManager.getDeviceById<SupportedDevice>(device) : undefined;

            let textToUpdate = text;
            if (listenerType === ListenerType.Face) {
                const label = (data as ObjectsDetected)?.detections?.find(det => det.className === 'face')?.label;
                textToUpdate = label;
            } else if (listenerType === ListenerType.Temperature) {
                textToUpdate = `${prefix || ''}${data} ${realDevice.temperatureUnit}`;
            } else if (listenerType === ListenerType.Humidity) {
                textToUpdate = `${prefix || ''}${data} %`;
            }

            if (textToUpdate) {
                currentContent.TextOverlay.displayText = [textToUpdate];

                await client.updateOverlayText(overlayId, currentContent);
            }
        } catch (e) {
            this.console.error('Error in updateOverlayData', e);
        }
    }

    async init() {
        try {
            await this.getOverlayData();

            this.checkInterval = setInterval(() => {
                try {
                    for (const overlayId of this.overlayIds) {
                        const overlay = getOverlay({
                            overlayId,
                            storage: this.storageSettings
                        });

                        const overlayType = overlay.type;
                        let listenerType: ListenerType;
                        let listenInterface: ScryptedInterface;
                        let deviceId: string;
                        if (overlayType === OverlayType.Device) {
                            const realDevice = sdk.systemManager.getDeviceById(overlay.device);
                            if (realDevice) {
                                if (realDevice.interfaces.includes(ScryptedInterface.Thermometer)) {
                                    listenerType = ListenerType.Temperature;
                                    listenInterface = ScryptedInterface.Thermometer;
                                    deviceId = overlay.device;
                                } else if (realDevice.interfaces.includes(ScryptedInterface.HumiditySensor)) {
                                    listenerType = ListenerType.Humidity;
                                    listenInterface = ScryptedInterface.HumiditySensor;
                                    deviceId = overlay.device;
                                }
                            } else {
                                this.console.log(`Device ${overlay.device} not found`);
                            }
                        } else if (overlayType === OverlayType.FaceDetection) {
                            listenerType = ListenerType.Face;
                            listenInterface = ScryptedInterface.ObjectDetection;
                            deviceId = this.id;
                        }

                        const currentListener = this.listenersMap[overlayId];
                        const currentDevice = currentListener?.device;
                        const differentType = (!currentListener || currentListener.listenerType !== listenerType);
                        const differentDevice = overlay.type === OverlayType.Device ? currentDevice !== overlay.device : false;
                        if (listenerType && listenInterface && deviceId && (differentType || differentDevice)) {
                            const realDevice = sdk.systemManager.getDeviceById<ScryptedDeviceBase>(deviceId);
                            this.console.log(`Overlay ${overlayId}: starting device ${realDevice.name} listener for type ${listenerType} on interface ${listenInterface}`);
                            currentListener?.listener && currentListener.listener.removeListener();
                            this.listenersMap[overlayId] = {
                                listenerType,
                                device: overlay.device,
                                listener: realDevice.listen(listenInterface, (_, __, data) => {
                                    this.updateOverlayData({
                                        listenInterface,
                                        overlayId,
                                        data,
                                        listenerType,
                                        device: realDevice
                                    }).catch(this.console.error);
                                })
                            }
                        }
                    }
                } catch (e) {
                    this.console.error('Error in init interval', e);
                }

            }, 10 * 1000);
        } catch (e) {
            this.console.error('Error in init', e);
        }
    }
}