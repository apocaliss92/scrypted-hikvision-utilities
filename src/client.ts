import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { Readable } from 'stream';
import xml2js from 'xml2js';
import { Destroyable } from '../../scrypted/plugins/rtsp/src/rtsp';
import { MotionDetectionRoot } from './types';
import { MotionDetectionUpdateParams } from './utils';

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
}