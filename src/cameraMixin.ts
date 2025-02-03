import sdk, { ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import HikvisionVideoclipssProvider from "./main";
import { HikvisionCameraAPI } from "./client";
import { getOverlayKeys, getOverlay, getOverlaySettings, SupportedDevice, pluginEnabledFilter, OverlayType, ListenerType, ListenersMap, OnUpdateOverlayFn, listenersIntevalFn, parseOverlayData } from "./utils";

export default class HikvisionUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    client: HikvisionCameraAPI;
    killed: boolean;
    overlayIds: string[] = [];
    listenersMap: ListenersMap = {};
    checkInterval: NodeJS.Timeout;

    storageSettings = new StorageSettings(this, {
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
        if (key === 'duplicateFromDevice') {
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
                // const { textKey } = getOverlayKeys(id);
                // this.storageSettings.putSetting(textKey, overlayEntry.displayText?.[0]);
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
                // await this.getOverlayData();

                for (const overlayId of deviceToDuplicate.overlayIds) {
                    const { device, type, prefix } = getOverlay({ overlayId, storage: deviceToDuplicate.storageSettings });
                    const { deviceKey, typeKey, prefixKey } = getOverlayKeys(overlayId);

                    await this.putMixinSetting(deviceKey, device);
                    await this.putMixinSetting(typeKey, type);
                    await this.putMixinSetting(prefixKey, prefix);
                }
            }
        } catch (e) {
            this.console.error(`Error in duplicateFromDevice`, e);
        }
    }

    private updateOverlayData: OnUpdateOverlayFn = async (props) => {
        const { overlayId, listenerType, data, device } = props;
        this.console.log(`Update received from device ${device?.name} ${JSON.stringify({
            overlayId,
            listenerType,
            data
        })}`);

        try {
            const client = await this.getClient();
            const { json: currentContent } = await client.getOverlayText(overlayId);

            const overlay = getOverlay({ overlayId, storage: this.storageSettings });
            const textToUpdate = parseOverlayData({ data, listenerType, overlay });

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
            const funct = async () => {
                try {
                    listenersIntevalFn({
                        console: this.console,
                        currentListeners: this.listenersMap,
                        id: this.id,
                        onUpdateFn: this.updateOverlayData,
                        overlayIds: this.overlayIds,
                        storage: this.storageSettings
                    });
                    await this.getOverlayData();
                } catch (e) {
                    this.console.error('Error in init interval', e);
                }

            };

            this.checkInterval = setInterval(funct, 10 * 1000);
            await funct();
        } catch (e) {
            this.console.error('Error in init', e);
        }
    }
}