import sdk, { ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import HikvisionVideoclipssProvider from "./main";
import { HikvisionCameraAPI } from "./client";
import { MotionDetectionUpdateParams } from "./utils";

export default class HikvisionUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    client: HikvisionCameraAPI;
    killed: boolean;

    storageSettings = new StorageSettings(this, {
        motionEnabled: {
            title: 'Motion enabled',
            type: 'boolean',
            subgroup: 'Motion',
            immediate: true,
            onPut: async (_, value: boolean) => {
                await this.updateMotionDetection({ enabled: value });
            }
        },
        motionSensitivity: {
            title: 'Motion sensitivity',
            subgroup: 'Motion',
            type: 'string',
            choices: [],
            immediate: true,
            onPut: async (_, value: string) => {
                await this.updateMotionDetection({ motionSensitivity: value });
            }
        },
        motionRefetch: {
            title: 'Refetch',
            subgroup: 'Motion',
            type: 'button',
            onPut: async () => {
                await this.fetchMotionCapabilities();
            }
        },
    });

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: HikvisionVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    async init() {
        await this.fetchMotionCapabilities();
    }

    async fetchMotionCapabilities() {
        const client = await this.getClient();
        const { enabled, sensitivityLevel, sensitivityOptions } = await client.getMotionCapabilities();

        this.storageSettings.settings.motionSensitivity.choices = sensitivityOptions;
        this.storageSettings.values.motionEnabled = enabled;
        this.storageSettings.values.motionSensitivity = String(sensitivityLevel);
    }

    async updateMotionDetection({ enabled, motionSensitivity }: Partial<MotionDetectionUpdateParams>) {
        const client = await this.getClient();

        const props: MotionDetectionUpdateParams = {
            enabled,
            motionSensitivity,
        }
        this.console.log('Updating motion detection with params:', props);
        await client.updateMotionDetection(props);
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
        try {
            return this.storageSettings.getSettings();
        } catch (e) {
            this.console.error('Error in getMixinSettings', e);
            return [];
        }
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const [group, ...rest] = key.split(':');
        if (group === this.settingsGroupKey) {
            this.storageSettings.putSetting(rest.join(':'), value);
        } else {
            super.putSetting(key, value);
        }
    }

    async putMixinSetting(key: string, value: string) {
        this.storageSettings.putSetting(key, value);
    }
}