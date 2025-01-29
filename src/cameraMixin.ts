import sdk, { ScryptedDeviceType, Setting, Settings } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import HikvisionVideoclipssProvider from "./main";
import { HikvisionCameraAPI } from "./client";
import { getOverlayKeys, getOverlay, getOverlaySettings, updateCameraConfigurationRegex, SupportedDevice } from "./utils";

export default class HikvisionUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    client: HikvisionCameraAPI;
    killed: boolean;
    overlayIds: string[] = [];

    storageSettings = new StorageSettings(this, {
        updateInterval: {
            title: 'Update interval in seconds',
            type: 'number',
            defaultValue: 10
        },
        getCurrentOverlayConfigurations: {
            title: 'Get current overlay configurations',
            type: 'button',
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: HikvisionVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    async release() {
        this.killed = true;
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
        const updateCameraConfigurations = updateCameraConfigurationRegex.exec(key);

        if (key === 'getCurrentOverlayConfigurations') {
            await this.getOverlayData();
        } else if (updateCameraConfigurations) {
            const overlayId = updateCameraConfigurations[1];
            await this.updateOverlayData(overlayId);
        } else {
            this.storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }

    async getOverlayData() {
        const client = await this.getClient();
        const { json: currentOverlay } = await client.getOverlay();
        const overlayIds: string[] = [];

        const overlayEntries = currentOverlay.VideoOverlay.TextOverlayList;
        for (const overlayEntry of overlayEntries) {
            if (overlayEntry.TextOverlay) {
                const id = overlayEntry.TextOverlay[0]?.id?.[0];
                overlayIds.push(id);
                const { textKey } = getOverlayKeys(id);
                this.storageSettings.putSetting(textKey, overlayEntry.TextOverlay[0]?.displayText?.[0]);
            }
        }

        this.overlayIds = overlayIds;
    }

    async updateOverlayData(overlayId: string) {
        const client = await this.getClient();
        const { json: currentContent } = await client.getOverlayText(overlayId);

        const { device, isDevice, prefix, text } = getOverlay({ overlayId, storage: this.storageSettings });

        let textToUpdate = text;
        if (isDevice && device) {
            const realDevice = sdk.systemManager.getDeviceById<SupportedDevice>(device);

            if (realDevice.type === ScryptedDeviceType.Thermostat) {
                textToUpdate = `${prefix || ''}${realDevice.temperature} ${this.plugin.storageSettings.values.temperatureUnit}`;
            }
        }

        currentContent.TextOverlay.displayText = [textToUpdate];

        await client.updateOverlayText(overlayId, currentContent);
    }

    async init() {
        await this.getOverlayData();

        setInterval(async () => {
            for (const overlayId of this.overlayIds) {
                const overlay = getOverlay({
                    overlayId,
                    storage: this.storageSettings
                });
                if (overlay.isDevice && overlay.device) {
                    await this.updateOverlayData(overlayId);
                }
            }
        }, this.storageSettings.values.updateInterval * 1000);
    }
}