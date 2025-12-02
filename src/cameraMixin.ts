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
    audioCaps: any = null;
    timeCaps: any = null;
    osdCaps: any = null;
    ptzCaps: any = null;
    ptzPresets: any[] = [];
    deviceInfo: any = null;

    initStorage: StorageSettingsDict<string> = {}

    storageSettings = new StorageSettings(this, this.initStorage);

    constructor(options: SettingsMixinDeviceOptions<any>, private plugin: HikvisionVideoclipssProvider) {
        super(options);

        this.plugin.mixinsMap[this.id] = this;
        setTimeout(async () => !this.killed && await this.init(), 2000);
    }

    async init() {
        await this.fetchMotionCapabilities();
        await this.fetchStreamCapabilities();
        await this.fetchAudioCapabilities();
        await this.fetchTimeCapabilities();
        await this.fetchOSDCapabilities();
        await this.fetchPTZCapabilities();
        await this.fetchDeviceInfo();

        await this.refreshSettings();
        await this.refreshSettings();
    }

    async updateMotionCapabilities() {
        await this.fetchMotionCapabilities();
        this.setMotionSettingsValues();
    }

    async updateStreamCapabilities() {
        await this.fetchStreamCapabilities();
        this.setStreamSettingsValues(this.streamCaps);
    }

    async updateAudioCapabilities() {
        await this.fetchAudioCapabilities();
        this.setAudioSettingsValues();
    }

    async updateTimeCapabilities() {
        await this.fetchTimeCapabilities();
        this.setTimeSettingsValues();
    }

    async updateOSDCapabilities() {
        await this.fetchOSDCapabilities();
        this.setOSDSettingsValues();
    }

    async updatePTZCapabilities() {
        await this.fetchPTZCapabilities();
        this.setPTZSettingsValues();
    }

    async fetchMotionCapabilities() {
        const client = await this.getClient();
        this.motionCaps = await client.getMotionCapabilities();
        const eventTrigger = await client.getMotionEventTrigger();
        this.motionCaps.centerNotificationEnabled = eventTrigger.centerNotificationEnabled;
    }

    async fetchAudioCapabilities() {
        const client = await this.getClient();
        this.audioCaps = await client.getTwoWayAudioCapabilities();
    }

    async fetchTimeCapabilities() {
        const client = await this.getClient();
        this.timeCaps = await client.getTimeCapabilities();
    }

    async fetchOSDCapabilities() {
        const client = await this.getClient();
        const caps = await client.getOSDCapabilities();
        const current = await client.getOSD();
        const videoInput = await client.getVideoInputChannel();
        this.osdCaps = { ...caps, ...current, videoInputName: videoInput.name };
    }

    async fetchDeviceInfo() {
        const client = await this.getClient();
        this.deviceInfo = await client.getDeviceInfo();
    }

    async fetchPTZCapabilities() {
        const client = await this.getClient();
        try {
            this.ptzCaps = await client.getPTZCapabilities();
            this.ptzPresets = await client.getPTZPresets();
        } catch (e) {
            this.console.log('PTZ not supported or error fetching capabilities', e);
            this.ptzCaps = null;
            this.ptzPresets = [];
        }
    }

    generateMotionSettings() {
        const motionSettings: StorageSetting[] = [];

        if (!this.motionCaps) {
            return motionSettings;
        }

        // Motion Enabled setting
        motionSettings.push({
            key: 'motionEnabled',
            title: 'Motion Enabled',
            subgroup: 'Motion',
            type: 'boolean',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value && old !== undefined) {
                    await this.updateMotionDetection({ enabled: value });
                }
            }
        });

        // Motion Sensitivity setting
        motionSettings.push({
            key: 'motionSensitivity',
            title: 'Motion Sensitivity',
            subgroup: 'Motion',
            type: 'string',
            choices: this.motionCaps.sensitivityOptions,
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    await this.updateMotionDetection({ motionSensitivity: value });
                }
            }
        });

        // Center Notification setting
        motionSettings.push({
            key: 'motionCenterNotification',
            title: 'Send to Notification Center',
            description: 'Enable notifications to surveillance center',
            subgroup: 'Motion',
            type: 'boolean',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value && old !== undefined) {
                    await this.updateMotionEventTrigger({ centerNotificationEnabled: value });
                }
            }
        });

        // Refetch button
        motionSettings.push({
            key: 'motionRefetch',
            title: 'Refetch',
            subgroup: 'Motion',
            type: 'button',
            onPut: async () => {
                await this.updateMotionCapabilities();
            }
        });

        return motionSettings;
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

        // Refetch button
        streamSettings.push({
            key: 'streamsRefetch',
            title: 'Refetch',
            subgroup: 'Stream',
            type: 'button',
            onPut: async () => {
                await this.updateStreamCapabilities();
            }
        });

        return streamSettings;
    }

    generateAudioSettings() {
        const audioSettings: StorageSetting[] = [];

        if (!this.audioCaps) {
            return audioSettings;
        }

        // Audio Codec setting
        audioSettings.push({
            key: 'audioCodec',
            title: 'Audio Codec',
            subgroup: 'Audio',
            type: 'string',
            choices: this.audioCaps.audioCodecs,
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    await this.updateAudio({
                        audioCompressionType: value,
                    });
                }
            }
        });

        // Speaker Volume setting
        const volumeChoices: string[] = [];
        for (let i = this.audioCaps.speakerVolumeMin; i <= this.audioCaps.speakerVolumeMax; i += 10) {
            volumeChoices.push(String(i));
        }
        if (!volumeChoices.includes(String(this.audioCaps.speakerVolumeMax))) {
            volumeChoices.push(String(this.audioCaps.speakerVolumeMax));
        }

        audioSettings.push({
            key: 'speakerVolume',
            title: 'Speaker Volume',
            description: `Range: ${this.audioCaps.speakerVolumeMin}-${this.audioCaps.speakerVolumeMax}`,
            subgroup: 'Audio',
            type: 'string',
            choices: volumeChoices,
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    await this.updateAudio({
                        speakerVolume: Number(value),
                    });
                }
            }
        });

        // Noise Reduction setting
        if (this.audioCaps.supportsNoiseReduction) {
            audioSettings.push({
                key: 'noiseReduction',
                title: 'Noise Reduction',
                subgroup: 'Audio',
                type: 'boolean',
                immediate: true,
                onPut: async (old: boolean, value: boolean) => {
                    if (old !== value && old !== undefined) {
                        await this.updateAudio({
                            noiseReduction: value,
                        });
                    }
                }
            });
        }

        // Audio Input Type setting
        audioSettings.push({
            key: 'audioInputType',
            title: 'Audio Input Type',
            subgroup: 'Audio',
            type: 'string',
            choices: this.audioCaps.audioInputTypes,
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    await this.updateAudio({
                        audioInputType: value,
                    });
                }
            }
        });

        // Refetch button
        audioSettings.push({
            key: 'audioRefetch',
            title: 'Refetch',
            subgroup: 'Audio',
            type: 'button',
            onPut: async () => {
                await this.updateAudioCapabilities();
            }
        });

        return audioSettings;
    }

    generateTimeSettings() {
        const timeSettings: StorageSetting[] = [];

        if (!this.timeCaps) {
            return timeSettings;
        }

        // Get current timeMode from storage (if already set)
        const currentTimeMode = this.storageSettings.values['timeMode'];

        // Time Mode setting (NTP or manual) - ALWAYS show
        timeSettings.push({
            key: 'timeMode',
            title: 'Time Mode',
            subgroup: 'Time',
            type: 'string',
            choices: this.timeCaps.timeModes || [],
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    // If switching to manual mode, automatically send current time
                    if (value === 'manual') {
                        const now = new Date();
                        // Format: YYYY-MM-DDTHH:MM:SS
                        const localTime = now.toISOString().slice(0, 19);
                        await this.updateTime({
                            timeMode: value,
                            localTime: localTime,
                        });
                    } else {
                        await this.updateTime({
                            timeMode: value,
                        });
                    }
                    // Regenerate settings to show/hide conditional fields
                    await this.updateTimeCapabilities();
                    await this.refreshSettings();
                }
            }
        });

        // NTP Server settings (only shown when timeMode is NTP)
        if (currentTimeMode === 'NTP') {
            timeSettings.push({
                key: 'ntpServer',
                title: 'NTP Server IP',
                description: 'IP address of NTP server',
                subgroup: 'Time',
                type: 'string',
                immediate: false,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        await this.updateNTPServer({
                            ipAddress: value,
                        });
                    }
                }
            });

            timeSettings.push({
                key: 'ntpPort',
                title: 'NTP Server Port',
                description: 'Port number of NTP server',
                subgroup: 'Time',
                type: 'number',
                immediate: false,
                onPut: async (old: number, value: number) => {
                    if (old !== value && old !== undefined) {
                        await this.updateNTPServer({
                            portNo: value,
                        });
                    }
                }
            });

            // NTP Sync Interval in hours (1-36 hours)
            const syncIntervalChoices: string[] = [];
            for (let i = 1; i <= 36; i++) {
                syncIntervalChoices.push(`${i} hour${i > 1 ? 's' : ''}`);
            }

            timeSettings.push({
                key: 'ntpSyncInterval',
                title: 'NTP Sync Interval',
                description: 'How often to sync with NTP server',
                subgroup: 'Time',
                type: 'string',
                choices: syncIntervalChoices,
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        // Extract hours from "X hour(s)" and convert to minutes
                        const match = value.match(/^(\d+) hour/);
                        if (match) {
                            const hours = Number(match[1]);
                            const minutes = hours * 60;
                            await this.updateNTPServer({
                                synchronizeInterval: minutes,
                            });
                        }
                    }
                }
            });
        }

        // Time Zone setting - ALWAYS show
        const timezoneChoices = [
            'UTC-12:00:00', 'UTC-11:00:00', 'UTC-10:00:00', 'UTC-9:00:00', 'UTC-8:00:00',
            'UTC-7:00:00', 'UTC-6:00:00', 'UTC-5:00:00', 'UTC-4:00:00', 'UTC-3:00:00',
            'UTC-2:00:00', 'UTC-1:00:00', 'UTC+0:00:00', 'UTC+1:00:00', 'UTC+2:00:00',
            'UTC+3:00:00', 'UTC+4:00:00', 'UTC+5:00:00', 'UTC+6:00:00', 'UTC+7:00:00',
            'UTC+8:00:00', 'UTC+9:00:00', 'UTC+10:00:00', 'UTC+11:00:00', 'UTC+12:00:00'
        ];

        timeSettings.push({
            key: 'timeZone',
            title: 'Time Zone',
            description: 'Select timezone offset from UTC',
            subgroup: 'Time',
            type: 'string',
            choices: timezoneChoices,
            immediate: true,
            onPut: async (old: string, value: string) => {
                if (old !== value && old !== undefined) {
                    // Convert UTC+1:00:00 to CST-1:00:00 format (Hikvision uses CST with inverted sign)
                    const match = value.match(/UTC([+-])(\d+):00:00/);
                    if (match) {
                        const sign = match[1] === '+' ? '-' : '+';
                        const hours = match[2];
                        const baseTimezone = `CST${sign}${hours}:00:00`;

                        // Preserve DST if it was enabled
                        const dstSuffix = 'DST01:00:00,M3.5.0/02:00:00,M10.5.0/03:00:00';
                        const hasDST = this.storageSettings.values['daylightSaving'] === true;
                        const newTZ = hasDST ? `${baseTimezone}${dstSuffix}` : baseTimezone;

                        await this.updateTime({
                            timeZone: newTZ,
                        });
                    }
                }
            }
        });

        // Daylight Saving Time (DST) setting - ALWAYS show
        const dstSuffix = 'DST01:00:00,M3.5.0/02:00:00,M10.5.0/03:00:00';
        timeSettings.push({
            key: 'daylightSaving',
            title: 'Daylight Saving Time',
            description: 'Enable DST (Ora Legale)',
            subgroup: 'Time',
            type: 'boolean',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value && old !== undefined) {
                    // Get current timezone from storage and reconstruct it
                    const currentUTCTz = this.storageSettings.values['timeZone'] || 'UTC+1:00:00';
                    const match = currentUTCTz.match(/UTC([+-])(\d+):00:00/);
                    if (match) {
                        const sign = match[1] === '+' ? '-' : '+';
                        const hours = match[2];
                        const baseTZ = `CST${sign}${hours}:00:00`;
                        const newTZ = value ? `${baseTZ}${dstSuffix}` : baseTZ;

                        await this.updateTime({
                            timeZone: newTZ,
                        });
                    }
                }
            }
        });

        // Refetch button
        timeSettings.push({
            key: 'timeRefetch',
            title: 'Refetch',
            subgroup: 'Time',
            type: 'button',
            onPut: async () => {
                await this.updateTimeCapabilities();
            }
        });

        return timeSettings;
    }

    generateOSDSettings() {
        const osdSettings: StorageSetting[] = [];

        if (!this.osdCaps) {
            return osdSettings;
        }

        // Date/Time Overlay
        osdSettings.push({
            key: 'osdDateTimeEnabled',
            title: 'Show Date/Time',
            subgroup: 'OSD',
            type: 'boolean',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value && old !== undefined) {
                    await this.updateOSD({ dateTimeOverlay: { enabled: value } });
                }
            }
        });

        if (this.storageSettings.values['osdDateTimeEnabled']) {
            osdSettings.push({
                key: 'osdDateStyle',
                title: 'Date Format',
                subgroup: 'OSD',
                type: 'string',
                choices: ['YYYY-MM-DD', 'MM-DD-YYYY', 'DD-MM-YYYY'],
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ dateTimeOverlay: { dateStyle: value } });
                    }
                }
            });

            osdSettings.push({
                key: 'osdTimeStyle',
                title: 'Time Format',
                subgroup: 'OSD',
                type: 'string',
                choices: ['12hour', '24hour'],
                immediate: true,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ dateTimeOverlay: { timeStyle: value } });
                    }
                }
            });

            osdSettings.push({
                key: 'osdDisplayWeek',
                title: 'Show Week Day',
                subgroup: 'OSD',
                type: 'boolean',
                immediate: true,
                onPut: async (old: boolean, value: boolean) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ dateTimeOverlay: { displayWeek: value } });
                    }
                }
            });

            osdSettings.push({
                key: 'osdDateTimeX',
                title: 'Date/Time X Position',
                subgroup: 'OSD',
                type: 'number',
                immediate: false,
                onPut: async (old: number, value: number) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ dateTimeOverlay: { positionX: value } });
                    }
                }
            });

            osdSettings.push({
                key: 'osdDateTimeY',
                title: 'Date/Time Y Position',
                subgroup: 'OSD',
                type: 'number',
                immediate: false,
                onPut: async (old: number, value: number) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ dateTimeOverlay: { positionY: value } });
                    }
                }
            });
        }

        // Channel Name Overlay
        osdSettings.push({
            key: 'osdChannelNameEnabled',
            title: 'Show Channel Name',
            subgroup: 'OSD',
            type: 'boolean',
            immediate: true,
            onPut: async (old: boolean, value: boolean) => {
                if (old !== value && old !== undefined) {
                    await this.updateOSD({ channelNameOverlay: { enabled: value } });
                    await this.updateOSDCapabilities();
                    await this.refreshSettings();
                }
            }
        });

        if (this.storageSettings.values['osdChannelNameEnabled']) {
            osdSettings.push({
                key: 'osdChannelName',
                title: 'Channel Name',
                description: 'Updates the video input channel name which is used as channel name overlay',
                subgroup: 'OSD',
                type: 'string',
                immediate: false,
                onPut: async (old: string, value: string) => {
                    if (old !== value && old !== undefined) {
                        await this.updateVideoInputChannel(value);
                        if (this.osdCaps) {
                            this.osdCaps.videoInputName = value;
                        }
                    }
                }
            });

            osdSettings.push({
                key: 'osdChannelNameX',
                title: 'Channel Name X Position',
                subgroup: 'OSD',
                type: 'number',
                immediate: false,
                onPut: async (old: number, value: number) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ channelNameOverlay: { positionX: value } });
                    }
                }
            });

            osdSettings.push({
                key: 'osdChannelNameY',
                title: 'Channel Name Y Position',
                subgroup: 'OSD',
                type: 'number',
                immediate: false,
                onPut: async (old: number, value: number) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ channelNameOverlay: { positionY: value } });
                    }
                }
            });
        }

        // Text Overlays
        const maxTextOverlays = this.osdCaps.textOverlayListSize || 8;
        for (let i = 1; i <= maxTextOverlays; i++) {
            const id = String(i);
            osdSettings.push({
                key: `osdText${id}Enabled`,
                title: `Text Overlay ${id} Enabled`,
                subgroup: 'OSD',
                type: 'boolean',
                immediate: true,
                onPut: async (old: boolean, value: boolean) => {
                    if (old !== value && old !== undefined) {
                        await this.updateOSD({ textOverlays: [{ id, enabled: value }] });
                        await this.updateOSDCapabilities();
                        await this.refreshSettings();
                    }
                }
            });

            if (this.storageSettings.values[`osdText${id}Enabled`]) {
                osdSettings.push({
                    key: `osdText${id}Content`,
                    title: `Text Overlay ${id} Content`,
                    subgroup: 'OSD',
                    type: 'string',
                    immediate: false,
                    onPut: async (old: string, value: string) => {
                        if (old !== value && old !== undefined) {
                            await this.updateOSD({ textOverlays: [{ id, displayText: value }] });
                        }
                    }
                });

                osdSettings.push({
                    key: `osdText${id}X`,
                    title: `Text Overlay ${id} X`,
                    subgroup: 'OSD',
                    type: 'number',
                    immediate: false,
                    onPut: async (old: number, value: number) => {
                        if (old !== value && old !== undefined) {
                            await this.updateOSD({ textOverlays: [{ id, positionX: value }] });
                        }
                    }
                });

                osdSettings.push({
                    key: `osdText${id}Y`,
                    title: `Text Overlay ${id} Y`,
                    subgroup: 'OSD',
                    type: 'number',
                    immediate: false,
                    onPut: async (old: number, value: number) => {
                        if (old !== value && old !== undefined) {
                            await this.updateOSD({ textOverlays: [{ id, positionY: value }] });
                        }
                    }
                });
            }
        }

        // Refetch button
        osdSettings.push({
            key: 'refetchOSD',
            title: 'Refetch OSD Settings',
            subgroup: 'OSD',
            type: 'button',
            onPut: async () => {
                await this.updateOSDCapabilities();
                await this.refreshSettings();
            }
        });

        return osdSettings;
    }

    generatePTZSettings() {
        const ptzSettings: StorageSetting[] = [];

        if (!this.ptzCaps) {
            return ptzSettings;
        }

        const specialNos = this.ptzCaps.specialNos || [];
        // Limit to 32 presets for UI sanity, or use maxPresetNum if smaller
        const maxPresets = Math.min(this.ptzCaps.maxPresetNum || 32, 32);

        for (let i = 1; i <= maxPresets; i++) {
            if (specialNos.includes(i)) continue;

            const id = String(i);

            ptzSettings.push({
                key: `ptzPreset${id}Enabled`,
                title: `Preset ${id} Enabled`,
                subgroup: 'PTZ',
                type: 'boolean',
                immediate: true,
                onPut: async (old: boolean, value: boolean) => {
                    if (old !== value && old !== undefined) {
                        if (value) {
                            // Enable: Create with default name if not exists
                            const name = this.storageSettings.values[`ptzPreset${id}Name`] || `Preset ${id}`;
                            await this.updatePTZPreset(id, name);
                        } else {
                            // Disable: Delete preset
                            await this.deletePTZPreset(id);
                        }
                        await this.updatePTZCapabilities();
                        await this.refreshSettings();
                    }
                }
            });

            if (this.storageSettings.values[`ptzPreset${id}Enabled`]) {
                ptzSettings.push({
                    key: `ptzPreset${id}Name`,
                    title: `Preset ${id} Name`,
                    description: 'Updating name also sets preset to CURRENT position',
                    subgroup: 'PTZ',
                    type: 'string',
                    immediate: false,
                    onPut: async (old: string, value: string) => {
                        if (old !== value && old !== undefined) {
                            await this.updatePTZPreset(id, value);
                        }
                    }
                });

                ptzSettings.push({
                    key: `ptzPreset${id}Go`,
                    title: `Go to Preset ${id}`,
                    subgroup: 'PTZ',
                    type: 'button',
                    onPut: async () => {
                        await this.gotoPTZPreset(id);
                    }
                });
            }
        }

        // Refetch button
        ptzSettings.push({
            key: 'refetchPTZ',
            title: 'Refetch PTZ Settings',
            subgroup: 'PTZ',
            type: 'button',
            onPut: async () => {
                await this.updatePTZCapabilities();
                await this.refreshSettings();
            }
        });

        return ptzSettings;
    }

    generateInfoSettings() {
        const infoSettings: StorageSetting[] = [];

        if (!this.deviceInfo) {
            return infoSettings;
        }

        const infoFields = [
            { key: 'deviceName', title: 'Device Name' },
            { key: 'model', title: 'Model' },
            { key: 'serialNumber', title: 'Serial Number' },
            { key: 'firmwareVersion', title: 'Firmware Version' },
            { key: 'firmwareReleasedDate', title: 'Firmware Date' },
            { key: 'macAddress', title: 'MAC Address' },
            { key: 'deviceType', title: 'Device Type' },
        ];

        for (const field of infoFields) {
            if (field.key === 'deviceName') {
                infoSettings.push({
                    key: `info_${field.key}`,
                    title: field.title,
                    subgroup: 'Info',
                    type: 'string',
                    immediate: false,
                    onPut: async (oldValue: string, newValue: string) => {
                        const client = await this.getClient();
                        await client.updateDeviceInfo(newValue);
                        // Update local cache
                        if (this.deviceInfo) {
                            this.deviceInfo.deviceName = newValue;
                        }
                    }
                });
            } else {
                infoSettings.push({
                    key: `info_${field.key}`,
                    title: field.title,
                    subgroup: 'Info',
                    type: 'string',
                    readonly: true,
                });
            }
        }

        return infoSettings;
    }

    setMotionSettingsValues() {
        if (!this.motionCaps) return;

        // Set motion enabled value
        this.storageSettings.values['motionEnabled'] = this.motionCaps.enabled;

        // Set motion sensitivity value
        this.storageSettings.values['motionSensitivity'] = String(this.motionCaps.sensitivityLevel);

        // Set center notification enabled value
        this.storageSettings.values['motionCenterNotification'] = this.motionCaps.centerNotificationEnabled;
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

    async setAudioSettingsValues() {
        const client = await this.getClient();
        const audioConfig = await client.getTwoWayAudio();

        if (!audioConfig) return;

        // Set codec value
        this.storageSettings.values['audioCodec'] = audioConfig.audioCompressionType;

        // Set speaker volume value (convert to string to match choices type)
        this.storageSettings.values['speakerVolume'] = String(audioConfig.speakerVolume);

        // Set noise reduction value
        this.storageSettings.values['noiseReduction'] = audioConfig.noiseReduction;

        // Set audio input type value
        this.storageSettings.values['audioInputType'] = audioConfig.audioInputType;
    }

    async setTimeSettingsValues() {
        const client = await this.getClient();
        const timeConfig = await client.getTime();
        const ntpConfig = await client.getNTPServer();

        if (!timeConfig) return;

        // Set time mode value
        this.storageSettings.values['timeMode'] = timeConfig.timeMode;

        // Set NTP server values (if in NTP mode)
        if (timeConfig.timeMode === 'NTP' && ntpConfig) {
            this.storageSettings.values['ntpServer'] = ntpConfig.ipAddress;
            this.storageSettings.values['ntpPort'] = ntpConfig.portNo;

            // Convert minutes to hours for display
            const minutes = ntpConfig.synchronizeInterval;
            const hours = Math.round(minutes / 60);
            this.storageSettings.values['ntpSyncInterval'] = `${hours} hour${hours > 1 ? 's' : ''}`;
        }

        // Set timezone value - convert from CST-1:00:00 to UTC+1:00:00 format
        if (timeConfig.timeZone) {
            const baseTZ = timeConfig.timeZone.split('DST')[0]; // Remove DST part
            const match = baseTZ.match(/CST([+-])(\d+):00:00/);
            if (match) {
                const sign = match[1] === '-' ? '+' : '-'; // Invert sign for display
                const hours = match[2];
                this.storageSettings.values['timeZone'] = `UTC${sign}${hours}:00:00`;
            }
        }

        // Set daylight saving time value
        const hasDST = timeConfig.timeZone?.includes('DST');
        this.storageSettings.values['daylightSaving'] = hasDST;
    }

    setOSDSettingsValues() {
        if (!this.osdCaps) return;

        const { dateTimeOverlay, channelNameOverlay, textOverlayList } = this.osdCaps;

        if (dateTimeOverlay) {
            this.storageSettings.values['osdDateTimeEnabled'] = dateTimeOverlay.enabled?.[0] === 'true';
            this.storageSettings.values['osdDateStyle'] = dateTimeOverlay.dateStyle?.[0];
            this.storageSettings.values['osdTimeStyle'] = dateTimeOverlay.timeStyle?.[0];
            this.storageSettings.values['osdDisplayWeek'] = dateTimeOverlay.displayWeek?.[0] === 'true';
            this.storageSettings.values['osdDateTimeX'] = Number(dateTimeOverlay.positionX?.[0] || 0);
            this.storageSettings.values['osdDateTimeY'] = Number(dateTimeOverlay.positionY?.[0] || 0);
        }

        if (channelNameOverlay) {
            this.storageSettings.values['osdChannelNameEnabled'] = channelNameOverlay.enabled?.[0] === 'true';
            this.storageSettings.values['osdChannelName'] = this.osdCaps.videoInputName || '';
            this.storageSettings.values['osdChannelNameX'] = Number(channelNameOverlay.positionX?.[0] || 0);
            this.storageSettings.values['osdChannelNameY'] = Number(channelNameOverlay.positionY?.[0] || 0);
        }

        if (textOverlayList) {
            for (const overlay of textOverlayList) {
                const id = overlay.id?.[0];
                if (id) {
                    this.storageSettings.values[`osdText${id}Enabled`] = overlay.enabled?.[0] === 'true';
                    this.storageSettings.values[`osdText${id}Content`] = overlay.displayText?.[0] || '';
                    this.storageSettings.values[`osdText${id}X`] = Number(overlay.positionX?.[0]);
                    this.storageSettings.values[`osdText${id}Y`] = Number(overlay.positionY?.[0]);
                }
            }
        }
    }

    setPTZSettingsValues() {
        if (!this.ptzPresets) return;

        for (const preset of this.ptzPresets) {
            const id = preset.id?.[0];
            if (id) {
                this.storageSettings.values[`ptzPreset${id}Enabled`] = true;
                this.storageSettings.values[`ptzPreset${id}Name`] = preset.presetName?.[0] || `Preset ${id}`;
            }
        }
    }

    setInfoSettingsValues() {
        if (!this.deviceInfo) return;

        const infoFields = [
            'deviceName', 'model', 'serialNumber', 'firmwareVersion',
            'firmwareReleasedDate', 'macAddress', 'deviceType'
        ];

        for (const field of infoFields) {
            this.storageSettings.values[`info_${field}`] = this.deviceInfo[field] || '';
        }
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

    async updateAudio(params: Partial<any>) {
        const client = await this.getClient();

        this.console.log('Updating audio with params:', JSON.stringify(params, null, 2));

        await client.updateTwoWayAudio(params);

        // Don't refetch automatically to avoid infinite loops
    }

    async updateTime(params: Partial<any>) {
        const client = await this.getClient();

        this.console.log('Updating time with params:', JSON.stringify(params, null, 2));

        await client.updateTime(params);
    }

    async updateNTPServer(params: Partial<any>) {
        const client = await this.getClient();

        this.console.log('Updating NTP server with params:', JSON.stringify(params, null, 2));

        await client.updateNTPServer(params);
    }

    async updateOSD(params: any) {
        const client = await this.getClient();
        this.console.log('Updating OSD with params:', JSON.stringify(params, null, 2));
        await client.updateOSD(params);
    }

    async updateVideoInputChannel(name: string) {
        const client = await this.getClient();
        this.console.log(`Updating video input channel name to: ${name}`);
        await client.updateVideoInputChannel(name);
    }

    async updatePTZPreset(id: string, name: string) {
        const client = await this.getClient();
        this.console.log(`Updating PTZ preset ${id} with name: ${name}`);
        await client.updatePTZPreset(id, name);
    }

    async deletePTZPreset(id: string) {
        const client = await this.getClient();
        this.console.log(`Deleting PTZ preset ${id}`);
        await client.deletePTZPreset(id);
    }

    async gotoPTZPreset(id: string) {
        const client = await this.getClient();
        this.console.log(`Going to PTZ preset ${id}`);
        await client.gotoPTZPreset(id);
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

    async updateMotionEventTrigger({ centerNotificationEnabled }: { centerNotificationEnabled?: boolean }) {
        const client = await this.getClient();

        this.console.log('Updating motion event trigger with params:', { centerNotificationEnabled });
        await client.updateMotionEventTrigger({ centerNotificationEnabled });
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

        const infoSettings = this.generateInfoSettings();
        dynamicSettings.push(...infoSettings);

        const motionSettings = this.generateMotionSettings();
        dynamicSettings.push(...motionSettings);

        const streamSettings = this.generateStreamSettings(this.streamCaps);
        dynamicSettings.push(...streamSettings);

        const audioSettings = this.generateAudioSettings();
        dynamicSettings.push(...audioSettings);

        const timeSettings = this.generateTimeSettings();
        dynamicSettings.push(...timeSettings);

        const osdSettings = this.generateOSDSettings();
        dynamicSettings.push(...osdSettings);

        const ptzSettings = this.generatePTZSettings();
        dynamicSettings.push(...ptzSettings);

        this.storageSettings = await convertSettingsToStorageSettings({
            device: this,
            dynamicSettings,
            initStorage: this.initStorage
        });

        // Set values after settings are created
        this.setMotionSettingsValues();
        this.setStreamSettingsValues(this.streamCaps);
        this.setAudioSettingsValues();
        this.setTimeSettingsValues();
        this.setOSDSettingsValues();
        this.setPTZSettingsValues();
        this.setInfoSettingsValues();
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