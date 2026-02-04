import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { Readable } from 'stream';
import xml2js from 'xml2js';
import { Destroyable } from '../../scrypted/plugins/rtsp/src/rtsp';
import { DynamicCapRoot, MotionDetectionRoot, StreamingChannelListRoot, SupplementLightCapabilities, SupplementLightSettings } from './types';
import { MotionDetectionUpdateParams, StreamingChannelUpdateParams, formatFrameRate, formatKeyFrameInterval } from './utils';

export class HikvisionCameraAPI {
    credential: AuthFetchCredentialState;
    deviceModel: Promise<string>;
    listenerPromise: Promise<Destroyable>;
    channel = '101';

    constructor(public ip: string, username: string, password: string, channel: string, public console: Console) {
        this.credential = {
            username,
            password,
        };
        if (channel) {
            this.channel = channel;
        }
    }

    async request(urlOrOptions: string | URL | HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions : {
                url: urlOrOptions,
            },
            rejectUnauthorized: false,
            credential: this.credential,
            body: typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions?.body : body,
        });
        return response;
    }

    async getMotionCapabilities() {
        const channelId = String(this.channel?.[0] ?? 1);
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}//ISAPI/System/Video/inputs/channels/${channelId}/motionDetection/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as MotionDetectionRoot;

        const data = json.MotionDetection;
        const enabled = data.enabled[0]?._ === 'true';
        const sensitivtyData = data.MotionDetectionLayout[0]?.sensitivityLevel[0];
        const min = Number(sensitivtyData?.$?.min ?? "0");
        const max = Number(sensitivtyData?.$?.max ?? "100");
        const step = Number(sensitivtyData?.$?.step ?? "20");
        const sensitivityOptions = [String(min)];
        for (let i = min + step; i <= max; i += step) {
            sensitivityOptions.push(String(i));
        }
        const sensitivityLevel = Number(sensitivtyData?._ ?? "0");
        return { xml: response.body, enabled, sensitivityLevel, sensitivityOptions };
    }

    async updateMotionDetection(props: MotionDetectionUpdateParams) {
        const { enabled, motionSensitivity } = props;
        const channelId = String(this.channel?.[0] ?? 1);
        let { xml } = await this.getMotionCapabilities();

        if (enabled !== undefined) {
            xml = xml.replace(/<enabled[^>]*>.*?<\/enabled>/s, `<enabled>${enabled}</enabled>`);
        }

        if (motionSensitivity !== undefined) {
            xml = xml.replace(/<sensitivityLevel[^>]*>.*?<\/sensitivityLevel>/s, `<sensitivityLevel>${motionSensitivity}</sensitivityLevel>`);
        }

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/${channelId}/motionDetection`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async getStreamingChannels() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Streaming/channels`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        }) as StreamingChannelListRoot;

        // Extract channel configurations
        const channels = json.StreamingChannelList?.StreamingChannel?.map(channel => {
            const video = channel.Video?.[0];
            
            // Helper to extract value with attributes
            const getBitrateValue = (field: string | { _: string; $: { min: string; max: string } } | undefined) => {
                if (!field) return { value: 0, min: 32, max: 16384 };
                if (typeof field === 'string') return { value: Number(field), min: 32, max: 16384 };
                return {
                    value: Number(field._ || 0),
                    min: Number(field.$.min || 32),
                    max: Number(field.$.max || 16384)
                };
            };

            const constantBitRateData = getBitrateValue(video?.constantBitRate?.[0]);
            const vbrUpperCapData = getBitrateValue(video?.vbrUpperCap?.[0]);
            
            // Helper to extract GovLength with attributes
            const getGovLengthValue = (field: string | { _: string; $: { min: string; max: string } } | undefined) => {
                if (!field) return { value: 0, min: 1, max: 400 };
                if (typeof field === 'string') return { value: Number(field), min: 1, max: 400 };
                return {
                    value: Number(field._ || 0),
                    min: Number(field.$.min || 1),
                    max: Number(field.$.max || 400)
                };
            };
            
            // Use GovLength (frame-based GOP)
            const govLength = video?.GovLength?.[0];
            const govLengthData = getGovLengthValue(govLength);
            
            // Extract audio settings
            const audio = channel.Audio?.[0];
            
            return {
                id: channel.id?.[0],
                channelName: channel.channelName?.[0],
                enabled: channel.enabled?.[0] === 'true',
                audio: {
                    enabled: audio?.enabled?.[0] === 'true',
                    audioInputChannelID: Number(audio?.audioInputChannelID?.[0]),
                    audioCompressionType: audio?.audioCompressionType?.[0],
                },
                video: {
                    enabled: video?.enabled?.[0] === 'true',
                    videoCodecType: video?.videoCodecType?.[0],
                    videoResolutionWidth: Number(video?.videoResolutionWidth?.[0]),
                    videoResolutionHeight: Number(video?.videoResolutionHeight?.[0]),
                    maxFrameRate: Number(video?.maxFrameRate?.[0]),
                    maxFrameRateUI: formatFrameRate(Number(video?.maxFrameRate?.[0])),
                    videoQualityControlType: video?.videoQualityControlType?.[0] as 'VBR' | 'CBR',
                    constantBitRate: constantBitRateData.value,
                    constantBitRateMin: constantBitRateData.min,
                    constantBitRateMax: constantBitRateData.max,
                    vbrUpperCap: vbrUpperCapData.value,
                    vbrUpperCapMin: vbrUpperCapData.min,
                    vbrUpperCapMax: vbrUpperCapData.max,
                    fixedQuality: Number(video?.fixedQuality?.[0]),
                    govLength: govLengthData.value,
                    govLengthMin: govLengthData.min,
                    govLengthMax: govLengthData.max,
                    govLengthUI: formatKeyFrameInterval(
                        govLengthData.value,
                        Number(video?.maxFrameRate?.[0])
                    ),
                    smoothing: Number(video?.smoothing?.[0]),
                    H264Profile: video?.H264Profile?.[0],
                    H265Profile: video?.H265Profile?.[0],
                    smartCodecEnabled: video?.SmartCodec?.[0]?.enabled?.[0] === 'true',
                }
            };
        }) || [];

        return { xml: response.body, json, channels };
    }

    async updateStreamingChannel(params: StreamingChannelUpdateParams) {
        const { 
            channelId,
            videoCodecType, 
            videoResolutionWidth, 
            videoResolutionHeight, 
            maxFrameRate, 
            vbrUpperCap, 
            constantBitRate,
            govLength,
            fixedQuality,
            videoQualityControlType,
            smoothing,
            H264Profile,
            H265Profile,
            audioEnabled,
            smartCodecEnabled
        } = params;
        let { xml } = await this.getStreamingChannels();

        // Use channelId from params or fallback to this.channel
        const targetChannel = channelId || this.channel;

        // Find the specific channel section in the XML
        const channelRegex = new RegExp(`(<StreamingChannel[^>]*>[\\s\\S]*?<id>${targetChannel}<\\/id>[\\s\\S]*?<\\/StreamingChannel>)`, 'g');
        
        xml = xml.replace(channelRegex, (match) => {
            let updatedChannel = match;

            if (videoCodecType !== undefined) {
                updatedChannel = updatedChannel.replace(/<videoCodecType[^>]*>.*?<\/videoCodecType>/s, `<videoCodecType>${videoCodecType}</videoCodecType>`);
            }

            if (videoResolutionWidth !== undefined) {
                updatedChannel = updatedChannel.replace(/<videoResolutionWidth[^>]*>.*?<\/videoResolutionWidth>/s, `<videoResolutionWidth>${videoResolutionWidth}</videoResolutionWidth>`);
            }

            if (videoResolutionHeight !== undefined) {
                updatedChannel = updatedChannel.replace(/<videoResolutionHeight[^>]*>.*?<\/videoResolutionHeight>/s, `<videoResolutionHeight>${videoResolutionHeight}</videoResolutionHeight>`);
            }

            if (maxFrameRate !== undefined) {
                updatedChannel = updatedChannel.replace(/<maxFrameRate[^>]*>.*?<\/maxFrameRate>/s, `<maxFrameRate>${maxFrameRate}</maxFrameRate>`);
            }

            if (vbrUpperCap !== undefined) {
                updatedChannel = updatedChannel.replace(/<vbrUpperCap[^>]*>.*?<\/vbrUpperCap>/s, `<vbrUpperCap>${vbrUpperCap}</vbrUpperCap>`);
            }

            if (constantBitRate !== undefined) {
                updatedChannel = updatedChannel.replace(/<constantBitRate[^>]*>.*?<\/constantBitRate>/s, `<constantBitRate>${constantBitRate}</constantBitRate>`);
            }

            if (govLength !== undefined) {
                updatedChannel = updatedChannel.replace(
                    /<GovLength(\s+[^>]*)?>.*?<\/GovLength>/s,
                    (fullMatch, attributes) => {
                        const attrs = attributes || '';
                        return `<GovLength${attrs}>${govLength}</GovLength>`;
                    }
                );
            }

            if (fixedQuality !== undefined) {
                updatedChannel = updatedChannel.replace(/<fixedQuality[^>]*>.*?<\/fixedQuality>/s, `<fixedQuality>${fixedQuality}</fixedQuality>`);
            }

            if (videoQualityControlType !== undefined) {
                updatedChannel = updatedChannel.replace(/<videoQualityControlType[^>]*>.*?<\/videoQualityControlType>/s, `<videoQualityControlType>${videoQualityControlType}</videoQualityControlType>`);
            }

            if (smoothing !== undefined) {
                updatedChannel = updatedChannel.replace(/<smoothing[^>]*>.*?<\/smoothing>/s, `<smoothing>${smoothing}</smoothing>`);
            }

            if (H264Profile !== undefined) {
                updatedChannel = updatedChannel.replace(/<H264Profile[^>]*>.*?<\/H264Profile>/s, `<H264Profile>${H264Profile}</H264Profile>`);
            }

            if (H265Profile !== undefined) {
                updatedChannel = updatedChannel.replace(/<H265Profile[^>]*>.*?<\/H265Profile>/s, `<H265Profile>${H265Profile}</H265Profile>`);
            }

            if (audioEnabled !== undefined) {
                updatedChannel = updatedChannel.replace(
                    /<Audio[^>]*>([\s\S]*?)<enabled[^>]*>.*?<\/enabled>([\s\S]*?)<\/Audio>/s,
                    (fullMatch, before, after) => {
                        return `<Audio${before.match(/^[^>]*/)?.[0] || ''}>${before.replace(/^[^>]*/, '')}<enabled>${audioEnabled}</enabled>${after}</Audio>`;
                    }
                );
            }

            if (smartCodecEnabled !== undefined) {
                updatedChannel = updatedChannel.replace(
                    /<SmartCodec[^>]*>([\s\S]*?)<enabled[^>]*>.*?<\/enabled>([\s\S]*?)<\/SmartCodec>/s,
                    (fullMatch, before, after) => {
                        return `<SmartCodec${before.match(/^[^>]*/)?.[0] || ''}>${before.replace(/^[^>]*/, '')}<enabled>${smartCodecEnabled}</enabled>${after}</SmartCodec>`;
                    }
                );
            }

            return updatedChannel;
        });

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Streaming/channels/${targetChannel}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async getStreamingChannelCapabilities(channelId: string) {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Streaming/channels/${channelId}/dynamicCap`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as DynamicCapRoot;
        const data = json.DynamicCap;

        // Parse resolutions and frame rates
        const resolutions = data.ResolutionAvailableDscriptorList?.[0]?.ResolutionAvailableDscriptor?.map(desc => ({
            width: Number(desc.videoResolutionWidth?.[0]),
            height: Number(desc.videoResolutionHeight?.[0]),
            frameRates: desc.supportedFrameRate?.[0]?.split(',').map(fr => {
                const value = Number(fr);
                return {
                    value,
                    label: formatFrameRate(value)
                };
            }) || []
        })) || [];

        // Parse video codecs with detailed capabilities
        const videoCodecs = data.CodecParamDscriptorList?.[0]?.CodecParamDscriptor?.map(codec => ({
            type: codec.videoCodecType?.[0],
            supportProfile: codec.isSupportProfile?.[0] === 'true',
            supportSVC: codec.isSupportSVC?.[0] === 'true',
            cbrSupported: codec.CBRCap?.[0]?.isSupportSmooth?.[0] === 'true',
            vbrSupported: codec.VBRCap?.[0]?.isSupportSmooth?.[0] === 'true',
            smartCodecCap: codec.SmartCodecCap?.[0] ? {
                readOnlyParams: codec.SmartCodecCap[0].readOnlyParams?.[0]?.$?.opt?.split(',') || [],
                constantBitrateSupport: codec.SmartCodecCap[0].BitrateType?.[0]?.Constant?.[0]?.support?.[0]?.$?.opt?.split(',') || [],
                variableBitrateSupport: codec.SmartCodecCap[0].BitrateType?.[0]?.Variable?.[0]?.support?.[0]?.$?.opt?.split(',') || []
            } : undefined
        })) || [];

        // Extract all available frame rates across all resolutions
        const allFrameRates = [...new Set(
            resolutions.flatMap(r => r.frameRates.map(fr => fr.value))
        )].sort((a, b) => b - a).map(value => ({
            value,
            label: formatFrameRate(value)
        }));

        // Get quality control types from codec capabilities
        const qualityControlTypes: ('VBR' | 'CBR')[] = [];
        videoCodecs.forEach(codec => {
            if (codec.vbrSupported && !qualityControlTypes.includes('VBR')) {
                qualityControlTypes.push('VBR');
            }
            if (codec.cbrSupported && !qualityControlTypes.includes('CBR')) {
                qualityControlTypes.push('CBR');
            }
        });

        return {
            resolutions,
            videoCodecs,
            allFrameRates,
            qualityControlTypes,
        };
    }

    async getStreamingCapabilities() {
        const { channels } = await this.getStreamingChannels();
        
        // Get capabilities for each channel
        const channelsWithCapabilities = await Promise.all(
            channels.map(async (channel) => {
                const capabilities = await this.getStreamingChannelCapabilities(channel.id);
                return {
                    ...channel,
                    capabilities
                };
            })
        );

        return channelsWithCapabilities;
    }

    async getTwoWayAudioCapabilities() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/TwoWayAudio/channels/1/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.TwoWayAudioChannel;
        
        // Parse audio compression types
        const audioCompressionType = data.audioCompressionType?.[0];
        const audioCodecs = typeof audioCompressionType === 'object' 
            ? audioCompressionType.$.opt.split(',') 
            : [];

        // Parse audio input types
        const audioInputType = data.audioInputType?.[0];
        const audioInputTypes = typeof audioInputType === 'object'
            ? audioInputType.$.opt.split(',')
            : [];

        // Parse speaker volume range
        const speakerVolume = data.speakerVolume?.[0];
        const speakerVolumeMin = typeof speakerVolume === 'object' 
            ? Number(speakerVolume.$.min) 
            : 0;
        const speakerVolumeMax = typeof speakerVolume === 'object'
            ? Number(speakerVolume.$.max)
            : 100;

        return {
            audioCodecs,
            audioInputTypes,
            speakerVolumeMin,
            speakerVolumeMax,
            supportsNoiseReduction: data.noisereduce?.[0]?.$.opt?.includes('true') || false,
        };
    }

    async getTwoWayAudio() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/TwoWayAudio/channels/1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.TwoWayAudioChannel;

        return {
            xml: response.body,
            enabled: data.enabled?.[0] === 'true',
            audioCompressionType: data.audioCompressionType?.[0],
            speakerVolume: Number(data.speakerVolume?.[0]),
            noiseReduction: data.noisereduce?.[0] === 'true',
            audioInputType: data.audioInputType?.[0],
        };
    }

    async updateTwoWayAudio(params: {
        audioCompressionType?: string;
        speakerVolume?: number;
        noiseReduction?: boolean;
        audioInputType?: string;
    }) {
        let { xml } = await this.getTwoWayAudio();

        if (params.audioCompressionType !== undefined) {
            xml = xml.replace(/<audioCompressionType[^>]*>.*?<\/audioCompressionType>/s, `<audioCompressionType>${params.audioCompressionType}</audioCompressionType>`);
        }

        if (params.speakerVolume !== undefined) {
            xml = xml.replace(/<speakerVolume[^>]*>.*?<\/speakerVolume>/s, `<speakerVolume>${params.speakerVolume}</speakerVolume>`);
        }

        if (params.noiseReduction !== undefined) {
            xml = xml.replace(/<noisereduce[^>]*>.*?<\/noisereduce>/s, `<noisereduce>${params.noiseReduction}</noisereduce>`);
        }

        if (params.audioInputType !== undefined) {
            xml = xml.replace(/<audioInputType[^>]*>.*?<\/audioInputType>/s, `<audioInputType>${params.audioInputType}</audioInputType>`);
        }

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/TwoWayAudio/channels/1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async getTimeCapabilities() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/time/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.Time;
        
        // Parse time mode options
        const timeMode = data.timeMode?.[0];
        const timeModes = typeof timeMode === 'object' 
            ? timeMode.$.opt.split(',') 
            : [];

        return {
            timeModes,
        };
    }

    async getTime() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/time`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.Time;

        return {
            xml: response.body,
            timeMode: data.timeMode?.[0],
            localTime: data.localTime?.[0],
            timeZone: data.timeZone?.[0],
        };
    }

    async getNTPServer() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/time/ntpServers/1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.NTPServer;

        return {
            xml: response.body,
            ipAddress: data.ipAddress?.[0],
            portNo: Number(data.portNo?.[0]),
            synchronizeInterval: Number(data.synchronizeInterval?.[0]),
        };
    }

    async updateTime(params: {
        timeMode?: string;
        localTime?: string;
        timeZone?: string;
    }) {
        let { xml } = await this.getTime();

        if (params.timeMode !== undefined) {
            xml = xml.replace(/<timeMode[^>]*>.*?<\/timeMode>/s, `<timeMode>${params.timeMode}</timeMode>`);
        }

        if (params.localTime !== undefined) {
            // Remove existing localTime tag if present
            xml = xml.replace(/<localTime[^>]*>.*?<\/localTime>\s*/s, '');
            // Add new localTime after timeMode
            xml = xml.replace(/(<timeMode>[^<]*<\/timeMode>)/s, `$1\n    <localTime>${params.localTime}</localTime>`);
        }

        if (params.timeZone !== undefined) {
            xml = xml.replace(/<timeZone[^>]*>.*?<\/timeZone>/s, `<timeZone>${params.timeZone}</timeZone>`);
        }

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/time`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async updateNTPServer(params: {
        ipAddress?: string;
        portNo?: number;
        synchronizeInterval?: number;
    }) {
        let { xml } = await this.getNTPServer();

        if (params.ipAddress !== undefined) {
            xml = xml.replace(/<ipAddress[^>]*>.*?<\/ipAddress>/s, `<ipAddress>${params.ipAddress}</ipAddress>`);
        }

        if (params.portNo !== undefined) {
            xml = xml.replace(/<portNo[^>]*>.*?<\/portNo>/s, `<portNo>${params.portNo}</portNo>`);
        }

        if (params.synchronizeInterval !== undefined) {
            xml = xml.replace(/<synchronizeInterval[^>]*>.*?<\/synchronizeInterval>/s, `<synchronizeInterval>${params.synchronizeInterval}</synchronizeInterval>`);
        }

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/time/ntpServers/1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async getMotionEventTrigger() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/VMD-1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.EventTrigger;
        const notificationList = data.EventTriggerNotificationList?.[0]?.EventTriggerNotification || [];
        
        // Check if center notification exists
        const hasCenterNotification = notificationList.some((notification: any) => 
            notification.notificationMethod?.[0] === 'center'
        );

        return {
            xml: response.body,
            centerNotificationEnabled: hasCenterNotification,
        };
    }

    async updateMotionEventTrigger(params: {
        centerNotificationEnabled?: boolean;
    }) {
        let { xml } = await this.getMotionEventTrigger();

        if (params.centerNotificationEnabled !== undefined) {
            // Parse the XML to manipulate the notification list
            const json = await xml2js.parseStringPromise(xml, {
                explicitArray: true,
                mergeAttrs: false,
                attrkey: '$',
                charkey: '_'
            });

            const notificationList = json.EventTrigger.EventTriggerNotificationList?.[0]?.EventTriggerNotification || [];
            
            // Filter out center notification
            const filteredList = notificationList.filter((notification: any) => 
                notification.notificationMethod?.[0] !== 'center'
            );

            // Add center notification if enabled
            if (params.centerNotificationEnabled) {
                filteredList.push({
                    id: ['center'],
                    notificationMethod: ['center'],
                });
            }

            // Update the notification list
            if (!json.EventTrigger.EventTriggerNotificationList) {
                json.EventTrigger.EventTriggerNotificationList = [{}];
            }
            json.EventTrigger.EventTriggerNotificationList[0].EventTriggerNotification = filteredList;

            // Remove unwanted fields
            delete json.EventTrigger.$.version;
            delete json.EventTrigger.$.xmlns;
            delete json.EventTrigger.eventDescription;
            delete json.EventTrigger.dynVideoInputChannelID;
            
            // Remove notificationRecurrence from all notifications
            filteredList.forEach((notification: any) => {
                delete notification.notificationRecurrence;
            });

            // Build XML back
            const builder = new xml2js.Builder({
                headless: false,
                renderOpts: { pretty: false }
            });
            xml = builder.buildObject(json);
        }

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Event/triggers/VMD-1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });

        return response;
    }

    async getOSDCapabilities() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.VideoOverlay;

        return {
            xml: response.body,
            textOverlayListSize: Number(data.TextOverlayList?.[0]?.$?.size || 0),
            dateTimeOverlay: data.DateTimeOverlay?.[0],
            channelNameOverlay: data.channelNameOverlay?.[0],
        };
    }

    async getOSD() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.VideoOverlay;

        return {
            xml: response.body,
            normalizedScreenWidth: Number(data.normalizedScreenSize?.[0]?.normalizedScreenWidth?.[0] || 704),
            normalizedScreenHeight: Number(data.normalizedScreenSize?.[0]?.normalizedScreenHeight?.[0] || 576),
            textOverlayList: data.TextOverlayList?.[0]?.TextOverlay || [],
            dateTimeOverlay: data.DateTimeOverlay?.[0],
            channelNameOverlay: data.channelNameOverlay?.[0],
        };
    }

    async updateOSD(params: {
        dateTimeOverlay?: {
            enabled?: boolean;
            dateStyle?: string;
            timeStyle?: string;
            displayWeek?: boolean;
            positionX?: number;
            positionY?: number;
        };
        channelNameOverlay?: {
            enabled?: boolean;
            positionX?: number;
            positionY?: number;
        };
        textOverlays?: {
            id: string;
            enabled?: boolean;
            displayText?: string;
            positionX?: number;
            positionY?: number;
        }[];
    }) {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const videoOverlay = json.VideoOverlay;

        if (params.dateTimeOverlay) {
            const dto = videoOverlay.DateTimeOverlay?.[0];
            if (dto) {
                if (params.dateTimeOverlay.enabled !== undefined) dto.enabled = [String(params.dateTimeOverlay.enabled)];
                if (params.dateTimeOverlay.dateStyle !== undefined) dto.dateStyle = [params.dateTimeOverlay.dateStyle];
                if (params.dateTimeOverlay.timeStyle !== undefined) dto.timeStyle = [params.dateTimeOverlay.timeStyle];
                if (params.dateTimeOverlay.displayWeek !== undefined) dto.displayWeek = [String(params.dateTimeOverlay.displayWeek)];
                if (params.dateTimeOverlay.positionX !== undefined) dto.positionX = [String(params.dateTimeOverlay.positionX)];
                if (params.dateTimeOverlay.positionY !== undefined) dto.positionY = [String(params.dateTimeOverlay.positionY)];
            }
        }

        if (params.channelNameOverlay) {
            const cno = videoOverlay.channelNameOverlay?.[0];
            if (cno) {
                if (params.channelNameOverlay.enabled !== undefined) cno.enabled = [String(params.channelNameOverlay.enabled)];
                if (params.channelNameOverlay.positionX !== undefined) cno.positionX = [String(params.channelNameOverlay.positionX)];
                if (params.channelNameOverlay.positionY !== undefined) cno.positionY = [String(params.channelNameOverlay.positionY)];
            }
        }

        if (params.textOverlays) {
            const textList = videoOverlay.TextOverlayList?.[0]?.TextOverlay || [];
            
            for (const update of params.textOverlays) {
                let overlay = textList.find((t: any) => t.id?.[0] === update.id);
                
                if (!overlay) {
                    overlay = {
                        id: [update.id],
                        enabled: ['false'],
                        positionX: ['0'],
                        positionY: ['0'],
                        displayText: [''],
                        isPersistentText: ['true']
                    };
                    textList.push(overlay);
                }

                if (update.enabled !== undefined) overlay.enabled = [String(update.enabled)];
                if (update.displayText !== undefined) overlay.displayText = [update.displayText];
                if (update.positionX !== undefined) overlay.positionX = [String(update.positionX)];
                if (update.positionY !== undefined) overlay.positionY = [String(update.positionY)];
            }
            
            if (!videoOverlay.TextOverlayList) {
                videoOverlay.TextOverlayList = [{ $: { size: '8' }, TextOverlay: textList }];
            } else {
                videoOverlay.TextOverlayList[0].TextOverlay = textList;
            }
        }

        delete videoOverlay.$.version;
        delete videoOverlay.$.xmlns;

        const builder = new xml2js.Builder({
            headless: false,
            renderOpts: { pretty: false }
        });
        const newXml = builder.buildObject(json);

        return await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: newXml,
        });
    }

    async getPTZCapabilities() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/capabilities`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.PTZChanelCap;
        const specialNoOpt = data.PresetNameCap?.[0]?.specialNo?.[0]?.$?.opt || '';
        const specialNos = specialNoOpt.split(',').map(Number);

        return {
            xml: response.body,
            maxPresetNum: Number(data.maxPresetNum?.[0] || 0),
            specialNos,
        };
    }

    async getPTZPresets() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const data = json.PTZPresetList;
        return data.PTZPreset || [];
    }

    async updatePTZPreset(id: string, name: string) {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PTZPreset xmlns="http://www.isapi.org/ver20/XMLSchema" version="2.0">
    <id>${id}</id>
    <presetName>${name}</presetName>
</PTZPreset>`;

        return await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets/${id}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });
    }

    async deletePTZPreset(id: string) {
        return await this.request({
            method: 'DELETE',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets/${id}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
    }

    async gotoPTZPreset(id: string) {
        return await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/PTZCtrl/channels/1/presets/${id}/goto`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
    }

    async getDeviceInfo() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/deviceInfo`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        const info = json.DeviceInfo || {};
        return {
            xml: response.body,
            deviceName: info.deviceName?.[0],
            model: info.model?.[0],
            serialNumber: info.serialNumber?.[0],
            macAddress: info.macAddress?.[0],
            firmwareVersion: info.firmwareVersion?.[0],
            firmwareReleasedDate: info.firmwareReleasedDate?.[0],
            deviceType: info.deviceType?.[0],
        };
    }

    async getVideoInputChannel() {
        const channelId = String(this.channel?.[0] ?? 1);
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/${channelId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body, {
            explicitArray: true,
            mergeAttrs: false,
            attrkey: '$',
            charkey: '_'
        });

        return {
            xml: response.body,
            id: json.VideoInputChannel?.id?.[0],
            name: json.VideoInputChannel?.name?.[0],
            videoFormat: json.VideoInputChannel?.videoFormat?.[0],
        };
    }

    async updateVideoInputChannel(name: string) {
        const { xml } = await this.getVideoInputChannel();
        
        // Use regex to replace name to preserve all other fields and structure
        let newXml = xml;
        if (newXml.includes('<name>')) {
            newXml = newXml.replace(/<name>.*?<\/name>/, `<name>${name}</name>`);
        } else {
            newXml = newXml.replace('</VideoInputChannel>', `  <name>${name}</name>\n</VideoInputChannel>`);
        }

        const channelId = String(this.channel?.[0] ?? 1);
        return await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/${channelId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: newXml,
        });
    }

    async updateDeviceInfo(deviceName: string) {
        let { xml } = await this.getDeviceInfo();
        
        // Use regex to replace deviceName to preserve all other fields and structure
        // This avoids issues with "unusual parameters" or complex XML structures
        if (xml.includes('<deviceName>')) {
            xml = xml.replace(/<deviceName>.*?<\/deviceName>/, `<deviceName>${deviceName}</deviceName>`);
        } else {
            // Fallback if tag doesn't exist (unlikely for valid XML)
            xml = xml.replace('</DeviceInfo>', `  <deviceName>${deviceName}</deviceName>\n</DeviceInfo>`);
        }

        return await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/deviceInfo`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });
    }

    async getSupplementLightCapabilities(): Promise<SupplementLightCapabilities | null> {
        try {
            const channelId = String(this.channel?.[0] ?? 1);
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Image/channels/${channelId}/SupplementLight/capabilities`,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
            });
            const json = await xml2js.parseStringPromise(response.body, {
                explicitArray: true,
                mergeAttrs: false,
                attrkey: '$',
                charkey: '_'
            });

            const data = json.SupplementLight;

            // Available modes from opt attribute
            const modeData = data?.supplementLightMode?.[0];
            const optString = typeof modeData === 'object' ? modeData.$.opt : '';
            const opts = optString.split(',').map((s: string) => s.trim()).filter(Boolean);

            const modes: string[] = [];
            if (opts.includes('eventIntelligence')) modes.push('Smart');
            if (opts.includes('colorVuWhiteLight')) modes.push('White');
            if (opts.includes('irLight')) modes.push('IR');

            const cameraType: string =
                modes.length === 0 ? 'not-supported' :
                modes.length === 1 && modes[0] === 'White' ? 'white-only' :
                modes.length === 1 && modes[0] === 'IR' ? 'ir-only' :
                'smart-hybrid';

            // Brightness ranges
            const irBrightness = data?.irLightBrightness?.[0];
            const whiteBrightness = data?.whiteLightBrightness?.[0];

            const irBrightnessMin = typeof irBrightness === 'object' ? irBrightness.$.min : '0';
            const irBrightnessMax = typeof irBrightness === 'object' ? irBrightness.$.max : '100';
            const whiteBrightnessMin = typeof whiteBrightness === 'object' ? whiteBrightness.$.min : '0';
            const whiteBrightnessMax = typeof whiteBrightness === 'object' ? whiteBrightness.$.max : '100';

            // Brightness control options
            const mixedLightMode = data?.mixedLightBrightnessRegulatMode?.[0];
            const brightnessControlOptions = typeof mixedLightMode === 'object'
                ? mixedLightMode.$.opt.split(',')
                : ['auto', 'manual'];

            // Smart mode brightness control options
            const eventIntelConfig = data?.EventIntelligenceModeCfg?.[0];
            const smartBrightnessMode = eventIntelConfig?.brightnessRegulatMode?.[0];
            const smartBrightnessControlOptions = typeof smartBrightnessMode === 'object'
                ? smartBrightnessMode.$.opt.split(',')
                : ['auto', 'manual'];

            return {
                modes,
                cameraType: [cameraType],
                irBrightnessMin: [irBrightnessMin],
                irBrightnessMax: [irBrightnessMax],
                whiteBrightnessMin: [whiteBrightnessMin],
                whiteBrightnessMax: [whiteBrightnessMax],
                brightnessControlOptions,
                smartBrightnessControlOptions,
            };
        } catch (e: any) {
            if (e?.statusCode === 403 || e?.message?.includes('403')) {
                return null;
            }
            throw e;
        }
    }

    async getSupplementLight(): Promise<SupplementLightSettings | null> {
        try {
            const channelId = String(this.channel?.[0] ?? 1);
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Image/channels/${channelId}/SupplementLight`,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
            });
            const json = await xml2js.parseStringPromise(response.body, {
                explicitArray: true,
                mergeAttrs: false,
                attrkey: '$',
                charkey: '_'
            });

            const data = json.SupplementLight;
            const eventIntelConfig = data?.EventIntelligenceModeCfg?.[0];

            return {
                supplementLightMode: data?.supplementLightMode || ['close'],
                mixedLightBrightnessRegulatMode: data?.mixedLightBrightnessRegulatMode || ['manual'],
                irLightBrightness: data?.irLightBrightness,
                whiteLightBrightness: data?.whiteLightBrightness,
                eventIntelligenceConfig: eventIntelConfig ? [{
                    brightnessRegulatMode: eventIntelConfig.brightnessRegulatMode || ['manual'],
                    whiteLightBrightness: eventIntelConfig.whiteLightBrightness || ['100'],
                    irLightBrightness: eventIntelConfig.irLightBrightness || ['100'],
                }] : undefined,
            };
        } catch (e: any) {
            if (e?.statusCode === 403 || e?.message?.includes('403')) {
                return null;
            }
            throw e;
        }
    }

    async updateSupplementLight(params: {
        supplementLightMode?: string;
        mixedLightBrightnessRegulatMode?: string;
        irLightBrightness?: number;
        whiteLightBrightness?: number;
        eventIntelligenceConfig?: {
            brightnessRegulatMode?: string;
            whiteLightBrightness?: number;
            irLightBrightness?: number;
        };
    }): Promise<void> {
        const channelId = String(this.channel?.[0] ?? 1);

        const currentResponse = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Image/channels/${channelId}/SupplementLight`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });

        let xml = currentResponse.body;

        if (params.supplementLightMode !== undefined) {
            xml = xml.replace(
                /<supplementLightMode[^>]*>.*?<\/supplementLightMode>/s,
                `<supplementLightMode>${params.supplementLightMode}</supplementLightMode>`
            );
        }

        if (params.mixedLightBrightnessRegulatMode !== undefined) {
            xml = xml.replace(
                /<mixedLightBrightnessRegulatMode[^>]*>.*?<\/mixedLightBrightnessRegulatMode>/s,
                `<mixedLightBrightnessRegulatMode>${params.mixedLightBrightnessRegulatMode}</mixedLightBrightnessRegulatMode>`
            );
        }

        if (params.eventIntelligenceConfig) {
            const config = params.eventIntelligenceConfig;
            
            const eventBlockMatch = xml.match(/(<EventIntelligenceModeCfg[^>]*>)([\s\S]*?)(<\/EventIntelligenceModeCfg>)/);
            if (eventBlockMatch) {
                let eventBlock = eventBlockMatch[2];
                
                if (config.brightnessRegulatMode !== undefined) {
                    eventBlock = eventBlock.replace(
                        /<brightnessRegulatMode[^>]*>.*?<\/brightnessRegulatMode>/s,
                        `<brightnessRegulatMode>${config.brightnessRegulatMode}</brightnessRegulatMode>`
                    );
                }
                
                if (config.whiteLightBrightness !== undefined) {
                    eventBlock = eventBlock.replace(
                        /<whiteLightBrightness[^>]*>\d+<\/whiteLightBrightness>/s,
                        `<whiteLightBrightness>${config.whiteLightBrightness}</whiteLightBrightness>`
                    );
                }
                
                if (config.irLightBrightness !== undefined) {
                    eventBlock = eventBlock.replace(
                        /<irLightBrightness[^>]*>\d+<\/irLightBrightness>/s,
                        `<irLightBrightness>${config.irLightBrightness}</irLightBrightness>`
                    );
                }
                
                xml = xml.replace(
                    /(<EventIntelligenceModeCfg[^>]*>)([\s\S]*?)(<\/EventIntelligenceModeCfg>)/,
                    `$1${eventBlock}$3`
                );
            }
        }

        if (params.irLightBrightness !== undefined) {
            xml = xml.replace(
                /(<SupplementLight[^>]*>[\s\S]*?)(<irLightBrightness[^>]*>)\d+(<\/irLightBrightness>)([\s\S]*?<EventIntelligenceModeCfg)/,
                `$1$2${params.irLightBrightness}$3$4`
            );
        }

        if (params.whiteLightBrightness !== undefined) {
            const beforeReplace = xml;
            xml = xml.replace(
                /(<SupplementLight[^>]*>[\s\S]*?)(<whiteLightBrightness[^>]*>)\d+(<\/whiteLightBrightness>)([\s\S]*?<EventIntelligenceModeCfg)/,
                `$1$2${params.whiteLightBrightness}$3$4`
            );
            if (xml === beforeReplace) {
                xml = xml.replace(
                    /<whiteLightBrightness[^>]*>\d+<\/whiteLightBrightness>/,
                    `<whiteLightBrightness>${params.whiteLightBrightness}</whiteLightBrightness>`
                );
            }
        }

        const putResponse = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Image/channels/${channelId}/SupplementLight`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml,
        });
    }

    async updateOverexposeSuppress(enabled: boolean): Promise<void> {
        const channelId = String(this.channel?.[0] ?? 1);
        const url = `http://${this.ip}/ISAPI/Image/channels/${channelId}/exposure`;

        try {
            // get the current exposure settings to preserve ExposureType
            const getResponse = await this.request({
                method: 'GET',
                url,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
            });

            const currentXml = (getResponse as any)?.body ?? '';
            const exposureTypeMatch = currentXml.match(/<ExposureType>([^<]+)<\/ExposureType>/);
            const currentExposureType = exposureTypeMatch?.[1] ?? 'auto';

            const payload =
                `<?xml version="1.0" encoding="UTF-8"?>` +
                `<Exposure>` +
                `<ExposureType>${currentExposureType}</ExposureType>` +
                `<OverexposeSuppress><enabled>${enabled ? 'true' : 'false'}</enabled></OverexposeSuppress>` +
                `</Exposure>`;

            const response = await this.request({
                method: 'PUT',
                url,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
                body: payload,
            });

            const status = (response as any)?.statusCode ?? (response as any)?.status ?? 'unknown';

            if (typeof status === 'number' && status >= 400) {
                this.console.warn('[SmartSupplementLight] Non success HTTP status:', status);
            }
        } catch (e) {
            this.console.warn('[SmartSupplementLight] Failed to set OverexposeSuppress, ignoring.', e);
        }
    }

    async getAlarmCapabilities(): Promise<{ json: any; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/IO/inputs`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const json = await xml2js.parseStringPromise(xml, {
            explicitArray: false,
            mergeAttrs: true,
        });
        return { json, xml };
    }

    async getAlarm(port: string): Promise<{ json: any; xml: string }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/IO/inputs/${port}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const xml = response.body;
        const parsed = await xml2js.parseStringPromise(xml, { explicitArray: true });
        return { json: parsed.IOInputPort, xml };
    }

    async setAlarm(isOn: boolean): Promise<{ json: any; xml: string }> {
        const data = `<IOInputPort><id>1</id><enabled>true</enabled><triggering>${isOn ? 'low' : 'high'}</triggering></IOInputPort>`;

        const response = await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/IO/inputs/1`,
            responseType: 'text',
            headers: { 'Content-Type': 'application/xml' },
            body: data
        });

        const xml = response.body;
        let json = {};

        try {
            json = await xml2js.parseStringPromise(xml);
        } catch (error) {
            console.error("Failed to parse XML response for setAlarm:", error);
        }

        return { json, xml };
    }

    async getAlarmLinkageCapabilities(): Promise<{
        supportsBeep: boolean;
        supportsWhiteLight: boolean;
        supportsIO: boolean;
    }> {
        try {
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Event/triggersCap`,
                responseType: 'text',
                headers: {
                    'Content-Type': 'application/xml',
                },
            });

            const xml = response.body;
            const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
            
            const ioTriggerCap = parsed.EventTriggersCap?.IOTriggerCap || {};
            
            return {
                supportsBeep: ioTriggerCap.isSupportBeep === 'true',
                supportsWhiteLight: ioTriggerCap.isSupportWhiteLight === 'true',
                supportsIO: ioTriggerCap.isSupportIO === 'true',
            };
        } catch (e) {
            return {
                supportsBeep: false,
                supportsWhiteLight: false,
                supportsIO: false,
            };
        }
    }

    async getAlarmLinkages(): Promise<{
        beep: boolean;
        whiteLight: boolean;
        io: boolean;
        whiteLightDuration: number;
    }> {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/IO-1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });

        const xml = response.body;
        const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
        
        const notifications = parsed.EventTrigger?.EventTriggerNotificationList?.EventTriggerNotification || [];
        const notificationList = Array.isArray(notifications) ? notifications : [notifications];
        
        const linkages = {
            beep: false,
            whiteLight: false,
            io: false,
            whiteLightDuration: 5,
        };

        for (const notification of notificationList) {
            const method = notification.notificationMethod;
            if (method === 'beep') linkages.beep = true;
            if (method === 'whiteLight') {
                linkages.whiteLight = true;
                const duration = notification.WhiteLightAction?.whiteLightDurationTime;
                if (duration) linkages.whiteLightDuration = parseInt(duration, 10) || 5;
            }
            if (method === 'IO') linkages.io = true;
        }

        return linkages;
    }

    async setAlarmLinkages(linkages: {
        beep: boolean;
        whiteLight: boolean;
        io: boolean;
        whiteLightDuration: number;
    }): Promise<void> {
        
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/IO-1`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });

        const parsed = await xml2js.parseStringPromise(response.body, { explicitArray: true });
        
        const eventTrigger = parsed.EventTrigger;
        const notifications = eventTrigger?.EventTriggerNotificationList?.[0]?.EventTriggerNotification || [];
        
        const newNotifications: any[] = [];
        
        // Keep all notifications that are not alarm-related
        for (const notification of notifications) {
            const method = notification.notificationMethod?.[0];
            if (!['beep', 'whiteLight', 'IO'].includes(method)) {
                newNotifications.push(notification);
            }
        }
        
        // Add alarm linkage notifications only if enabled
        if (linkages.beep) {
            newNotifications.push({
                id: ['beep'],
                notificationMethod: ['beep'],
                notificationRecurrence: ['beginning'],
            });
        }
        
        if (linkages.whiteLight) {
            newNotifications.push({
                id: ['whiteLight'],
                notificationMethod: ['whiteLight'],
                notificationRecurrence: ['beginning'],
                WhiteLightAction: [{
                    whiteLightDurationTime: [linkages.whiteLightDuration.toString()],
                }],
            });
        }
        
        if (linkages.io) {
            newNotifications.push({
                id: ['IO-1'],
                notificationMethod: ['IO'],
                notificationRecurrence: ['beginning'],
                outputIOPortID: ['1'],
            });
        }
        
        if (!eventTrigger.EventTriggerNotificationList) {
            eventTrigger.EventTriggerNotificationList = [{}];
        }
        eventTrigger.EventTriggerNotificationList[0].EventTriggerNotification = newNotifications;
        
        const builder = new xml2js.Builder({
            xmldec: { version: '1.0', encoding: 'UTF-8' },
            renderOpts: { pretty: true },
        });
        
        const xmlData = builder.buildObject(parsed);
        this.console.log('Generated XML:', xmlData);
        
        await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Event/triggers/IO-1`,
            responseType: 'text',
            headers: { 'Content-Type': 'application/xml' },
            body: xmlData,
        });
        
        this.console.log('setAlarmLinkages completed successfully');
    }

    async getAudioAlarmCapabilities(): Promise<{
        supported: boolean;
        audioTypes: { id: number; description: string }[];
        volumeRange: { min: number; max: number };
        alarmTimesRange: { min: number; max: number };
    } | null> {
        try {
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Event/triggers/notifications/AudioAlarm/capabilities?format=json`,
                responseType: 'json',
            });
            
            const cap = response.body?.AudioAlarmCap;
            if (!cap) return null;
            
            const audioList = cap.AlertAudioTypeListCap || cap.audioTypeListCap || [];
            const audioTypes = audioList.map((item: any) => ({
                id: item.alertAudioID || item.audioID,
                description: item.alertAudioDescription || item.audioDescription,
            }));
            
            return {
                supported: true,
                audioTypes,
                volumeRange: {
                    min: cap.audioVolume?.['@min'] || 1,
                    max: cap.audioVolume?.['@max'] || 100,
                },
                alarmTimesRange: {
                    min: cap.alarmTimes?.['@min'] || 1,
                    max: cap.alarmTimes?.['@max'] || 50,
                },
            };
        } catch (e) {
            return null;
        }
    }

    async getAudioAlarmSettings(): Promise<{
        audioID: number;
        audioVolume: number;
        alarmTimes: number;
    } | null> {
        try {
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Event/triggers/notifications/AudioAlarm?format=json`,
                responseType: 'json',
            });
            
            const alarm = response.body?.AudioAlarm;
            if (!alarm) return null;
            
            return {
                audioID: alarm.alertAudioID || alarm.audioID || 1,
                audioVolume: alarm.audioVolume || 50,
                alarmTimes: alarm.alarmTimes || 5,
            };
        } catch (e) {
            return null;
        }
    }

    async setAudioAlarmSettings(settings: {
        audioID: number;
        audioVolume: number;
        alarmTimes: number;
    }): Promise<void> {
        const currentResponse = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/notifications/AudioAlarm?format=json`,
            responseType: 'json',
        });
        
        const current = currentResponse.body?.AudioAlarm || {};
        
        const audioAlarm = {
            AudioAlarm: {
                ...current,
                audioID: settings.audioID,
                alertAudioID: settings.audioID,
                audioVolume: settings.audioVolume,
                alarmTimes: settings.alarmTimes,
            },
        };
        
        await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Event/triggers/notifications/AudioAlarm?format=json`,
            responseType: 'json',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(audioAlarm),
        });
    }

    async getWhiteLightAlarmCapabilities(): Promise<{
        supported: boolean;
        durationRange: { min: number; max: number };
        frequencyOptions: string[];
    } | null> {
        try {
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Event/triggers/notifications/whiteLightAlarm/capabilities?format=json`,
                responseType: 'json',
            });
            
            const cap = response.body?.WhiteLightAlarmCap;
            if (!cap) return null;
            
            const frequencyOpt = cap.frequency?.['@opt'] || 'high,medium,low,normallyOn';
            
            return {
                supported: true,
                durationRange: {
                    min: cap.durationTime?.['@min'] || 1,
                    max: cap.durationTime?.['@max'] || 60,
                },
                frequencyOptions: frequencyOpt.split(','),
            };
        } catch (e) {
            return null;
        }
    }

    async getWhiteLightAlarmSettings(): Promise<{
        durationTime: number;
        frequency: string;
    } | null> {
        try {
            const response = await this.request({
                method: 'GET',
                url: `http://${this.ip}/ISAPI/Event/triggers/notifications/whiteLightAlarm?format=json`,
                responseType: 'json',
            });
            
            const alarm = response.body?.WhiteLightAlarm;
            if (!alarm) return null;
            
            return {
                durationTime: alarm.durationTime || 15,
                frequency: alarm.frequency || 'medium',
            };
        } catch (e) {
            return null;
        }
    }

    async setWhiteLightAlarmSettings(settings: {
        durationTime: number;
        frequency: string;
    }): Promise<void> {
        const currentResponse = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/Event/triggers/notifications/whiteLightAlarm?format=json`,
            responseType: 'json',
        });
        
        const current = currentResponse.body?.WhiteLightAlarm || {};
        
        const whiteLightAlarm = {
            WhiteLightAlarm: {
                ...current,
                durationTime: settings.durationTime,
                frequency: settings.frequency,
            },
        };
        
        await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/Event/triggers/notifications/whiteLightAlarm?format=json`,
            responseType: 'json',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(whiteLightAlarm),
        });
    }
}