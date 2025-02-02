import sdk, { DeviceBase, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, WritableDeviceState } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import HikvisionUtilitiesMixin from "./cameraMixin";
import { HIKVISION_UTILITIES_INTERFACE, OverlayType } from "./utils";

export default class HikvisionUtilitiesProvider extends ScryptedDeviceBase implements MixinProvider {
    storageSettings = new StorageSettings(this, {
    });
    public mixinsMap: Record<string, HikvisionUtilitiesMixin> = {};

    constructor(nativeId: string) {
        super(nativeId);

        this.init().catch(this.console.log);
    }

    async init() {
    }

    async getSettings() {
        const settings: Setting[] = await this.storageSettings.getSettings();

        return settings;
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }


    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.VideoCamera,
        ].some(int => interfaces.includes(int)) ?
            [
                HIKVISION_UTILITIES_INTERFACE,
                ScryptedInterface.Settings,
            ] :
            undefined;
    }

    async getMixin(mixinDevice: DeviceBase, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new HikvisionUtilitiesMixin(
            {
                mixinDevice,
                mixinDeviceInterfaces,
                mixinDeviceState,
                mixinProviderNativeId: this.nativeId,
                group: 'Hikvision utilities',
                groupKey: 'hikvisionUtilities',
            },
            this);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}