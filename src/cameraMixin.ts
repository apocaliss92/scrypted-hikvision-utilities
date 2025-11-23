import { Setting, Settings, SettingValue } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSetting, StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import keyBy from "lodash/keyBy";
import { HikvisionCameraAPI } from "./client";
import HikvisionVideoclipssProvider from "./main";
import { convertSettingsToStorageSettings, generateBitrateChoices, MotionDetectionUpdateParams } from "./utils";

export default class HikvisionUtilitiesMixin extends SettingsMixinDeviceBase<any> implements Settings {
    client: HikvisionCameraAPI;
    killed: boolean;
    streamCaps: any[] = [];
    motionCaps: any = null;

    initStorage: StorageSettingsDict<string> = {
        motionEnabled: {
            title: 'Motion enabled',
            type: 'boolean',
            subgroup: 'Motion',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value) {
                    await this.updateMotionDetection({ enabled: value });
                }
            }
        },
        motionSensitivity: {
            title: 'Motion sensitivity',
            subgroup: 'Motion',
            type: 'string',
            choices: [],
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value) {
                    await this.updateMotionDetection({ motionSensitivity: value });
                }
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
        streamsRefetch: {
            title: 'Refetch',
            subgroup: 'Stream',
            type: 'button',
            onPut: async () => {
                await this.updateStreamCapabilities();
            }
        },
    }

    storageSettings = new StorageSettings(this, this.initStorage);

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: HikvisionVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    async init() {
        await this.fetchMotionCapabilities();
        await this.fetchStreamCapabilities();

        await this.refreshSettings();
        await this.refreshSettings();

        this.storageSettings.settings.motionSensitivity.choices = this.motionCaps.sensitivityOptions;
        this.storageSettings.values.motionEnabled = this.motionCaps.enabled;
        this.storageSettings.values.motionSensitivity = String(this.motionCaps.sensitivityLevel);

        this.setStreamSettingsValues(this.streamCaps);
    }

    async updateStreamCapabilities() {
        await this.fetchStreamCapabilities();
        this.setStreamSettingsValues(this.streamCaps);
    }

    async fetchMotionCapabilities() {
        const client = await this.getClient();
        this.motionCaps = await client.getMotionCapabilities();
    }

    generateStreamSettings(streamCaps: any[]) {
        const streamSettings: StorageSetting[] = [];

        for (const channel of streamCaps) {
            const streamId = channel.id!;
            const caps = channel.capabilities!;

            streamSettings.push({
                key: `${streamId}:name`,
                title: `Stream name`,
                description: `${streamId}`,
                subgroup: 'Stream',
                type: 'html',
            });

            // Resolution setting
            const resolutionChoices = caps.resolutions.map(res =>
                `${res.width}x${res.height}`
            );
            streamSettings.push({
                key: `${streamId}:videoResolution`,
                title: `Resolution (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: resolutionChoices,
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        const [width, height] = value.split('x').map(Number);
                        await this.updateStreamingChannel(streamId, {
                            videoResolutionWidth: width,
                            videoResolutionHeight: height,
                        });
                    }
                }
            });

            // FPS setting
            const fpsChoices = caps.allFrameRates.map(fr => fr.label);
            streamSettings.push({
                key: `${streamId}:maxFrameRate`,
                title: `FPS (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: fpsChoices,
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        const frameRateValue = caps.allFrameRates.find(fr => fr.label === value)?.value;
                        if (frameRateValue) {
                            await this.updateStreamingChannel(streamId, {
                                maxFrameRate: frameRateValue,
                            });
                        }
                    }
                }
            });

            // Quality control type setting
            streamSettings.push({
                key: `${streamId}:videoQualityControlType`,
                title: `Quality Control (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: caps.qualityControlTypes,
                immediate: true,
                // onPut: async (old: string, value: string) => {
                //     if (old !== value) {
                //         await this.updateStreamingChannel(streamId, {
                //             videoQualityControlType: value as 'VBR' | 'CBR',
                //         });
                //     }
                // }
            });

            // Bitrate setting (kbps) - choices will be dynamic based on quality control type
            streamSettings.push({
                key: `${streamId}:bitrate`,
                title: `Bitrate kbps (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: [], // Will be populated in setStreamSettingsValues
                immediate: true,
                // onPut: async (old: number, value: number) => {
                //     if (old !== value) {
                //         const updateParams = video.videoQualityControlType === 'VBR'
                //             ? { vbrUpperCap: value }
                //             : { constantBitRate: value };
                //         await this.updateStreamingChannel(streamId, updateParams);
                //     }
                // }
            });

            // Video codec type setting
            const codecChoices = caps.videoCodecs.map(codec => codec.type);
            streamSettings.push({
                key: `${streamId}:videoCodecType`,
                title: `Video Codec (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: codecChoices,
                immediate: true,
                // onPut: async (old: string, value: string) => {
                //     if (old !== value) {
                //         await this.updateStreamingChannel(streamId, {
                //             videoCodecType: value,
                //         });
                //     }
                // }
            });

            // Keyframe interval (GOP/I-Frame) setting in seconds
            const video = channel.video!;
            const audio = channel.audio!;
            
            // Calculate min/max in seconds based on GovLength (frame count)
            // govLength (frames) / fps = seconds
            const fps = video.maxFrameRate / 100; // Convert centesimal to fps
            const govLengthMinSec = Math.ceil(video.govLengthMin / fps);
            const govLengthMaxSec = Math.floor(video.govLengthMax / fps);
                
            const govLengthChoices: string[] = [];
            for (let i = govLengthMinSec; i <= govLengthMaxSec; i++) {
                govLengthChoices.push(String(i));
            }
            
            streamSettings.push({
                key: `${streamId}:govLength`,
                title: `I-Frame Interval (Stream ${streamId})`,
                description: `Min: ${govLengthMinSec}s, Max: ${govLengthMaxSec}s (GOP)`,
                subgroup: 'Stream',
                type: 'string',
                choices: govLengthChoices,
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        // Convert seconds to frame count: seconds * fps
                        const govLengthInFrames = Math.round(Number(value) * fps);
                        
                        await this.updateStreamingChannel(streamId, {
                            govLength: govLengthInFrames,
                        });
                    }
                }
            });

            // Fixed Quality setting
            const fixedQualityChoices = [
                'Minimum (1)',
                'Very Low (20)',
                'Low (40)',
                'Medium (60)',
                'High (80)',
                'Maximum (100)'
            ];
            
            streamSettings.push({
                key: `${streamId}:fixedQuality`,
                title: `Fixed Quality (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'string',
                choices: fixedQualityChoices,
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        // Extract number from label like "Maximum (100)" -> 100
                        const match = value.match(/\((\d+)\)/);
                        const numericValue = match ? Number(match[1]) : Number(value);
                        
                        this.console.log(`Setting fixedQuality for stream ${streamId}: ${value} -> ${numericValue}`);
                        
                        await this.updateStreamingChannel(streamId, {
                            fixedQuality: numericValue,
                        });
                    }
                }
            });

            // Audio enabled setting
            streamSettings.push({
                key: `${streamId}:audioEnabled`,
                title: `Audio Enabled (Stream ${streamId})`,
                subgroup: 'Stream',
                type: 'boolean',
                immediate: true,
                onPut: async (old: boolean, value: boolean) => {
                    if (old !== value && old !== undefined) {
                        await this.updateStreamingChannel(streamId, {
                            audioEnabled: value,
                        });
                    }
                }
            });

            // Smart Codec (H.265+) setting - only show for H.265 codec
            if (video.videoCodecType === 'H.265') {
                streamSettings.push({
                    key: `${streamId}:smartCodecEnabled`,
                    title: `H.265+ Smart Codec (Stream ${streamId})`,
                    description: 'Enable H.265+ for better compression',
                    subgroup: 'Stream',
                    type: 'boolean',
                    immediate: true,
                    onPut: async (old: boolean, value: boolean) => {
                        if (old !== value && old !== undefined) {
                            await this.updateStreamingChannel(streamId, {
                                smartCodecEnabled: value,
                            });
                        }
                    }
                });
            }
        }

        return streamSettings;
    }

    setStreamSettingsValues(streamCaps: any[]) {
        for (const channel of streamCaps) {
            const streamId = channel.id!;
            const video = channel.video!;

            // Set resolution value
            this.storageSettings.values[`${streamId}:videoResolution`] =
                `${video.videoResolutionWidth}x${video.videoResolutionHeight}`;

            // Set FPS value
            this.storageSettings.values[`${streamId}:maxFrameRate`] = video.maxFrameRateUI;

            // Set quality control type value
            this.storageSettings.values[`${streamId}:videoQualityControlType`] = video.videoQualityControlType;

            // Set bitrate value and update choices based on quality control type
            const currentBitrate = video.videoQualityControlType === 'VBR'
                ? video.vbrUpperCap
                : video.constantBitRate;

            const bitrateMin = video.videoQualityControlType === 'VBR'
                ? video.vbrUpperCapMin
                : video.constantBitRateMin;
            const bitrateMax = video.videoQualityControlType === 'VBR'
                ? video.vbrUpperCapMax
                : video.constantBitRateMax;

            const bitrateChoices = generateBitrateChoices(bitrateMin, bitrateMax);
            this.storageSettings.settings[`${streamId}:bitrate`].choices = bitrateChoices;
            this.storageSettings.values[`${streamId}:bitrate`] = String(currentBitrate);

            // Set video codec type value
            this.storageSettings.values[`${streamId}:videoCodecType`] = video.videoCodecType;

            // Set GOP length value (already in seconds from govLengthUI)
            this.storageSettings.values[`${streamId}:govLength`] = String(video.govLengthUI);

            // Set fixed quality value with label
            const fixedQualityLabels: Record<number, string> = {
                1: 'Minimum (1)',
                20: 'Very Low (20)',
                40: 'Low (40)',
                60: 'Medium (60)',
                80: 'High (80)',
                100: 'Maximum (100)'
            };
            const fixedQualityLabel = fixedQualityLabels[video.fixedQuality] || `Custom (${video.fixedQuality})`;
            this.storageSettings.values[`${streamId}:fixedQuality`] = fixedQualityLabel;

            // Set audio enabled value
            const audio = channel.audio!;
            this.storageSettings.values[`${streamId}:audioEnabled`] = audio.enabled;

            // Set smart codec enabled value (only if H.265)
            if (video.videoCodecType === 'H.265') {
                this.storageSettings.values[`${streamId}:smartCodecEnabled`] = video.smartCodecEnabled;
            }
        }
    }

    async fetchStreamCapabilities() {
        const client = await this.getClient();
        this.streamCaps = await client.getStreamingCapabilities();
    }

    async updateStreamingChannel(streamId: string, params: Partial<any>) {
        const client = await this.getClient();

        this.console.log(`Updating stream ${streamId} with params:`, JSON.stringify(params, null, 2));

        await client.updateStreamingChannel({
            channelId: streamId,
            ...params
        });

        // Don't refetch automatically to avoid infinite loops
        // The user can manually refetch using the "Refetch" button if needed
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

    async refreshSettings() {
        const dynamicSettings: StorageSetting[] = [];

        const streamSettings = this.generateStreamSettings(this.streamCaps);
        dynamicSettings.push(...streamSettings);

        this.storageSettings = await convertSettingsToStorageSettings({
            device: this,
            dynamicSettings,
            initStorage: this.initStorage
        });

        // Set values after settings are created
        this.setStreamSettingsValues(this.streamCaps);
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