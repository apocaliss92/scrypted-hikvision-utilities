import { AuthFetchCredentialState, HttpFetchOptions, authHttpFetch } from '@scrypted/common/src/http-auth-fetch';
import { Readable } from 'stream';
import xml2js from 'xml2js';
import { Destroyable } from '../../scrypted/plugins/rtsp/src/rtsp';
import { TextOverlayRoot, VideoOverlayRoot } from './types';

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

    async getOverlay() {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as VideoOverlayRoot;

        return { json, xml: response.body };
    }

    async updateOverlay(entry: VideoOverlayRoot) {
        const builder = new xml2js.Builder();
        const xml = builder.buildObject(entry);

        await this.request({
            method: 'PUT',
            url: `http://${this.ip}/ISAPI/System/Video/inputs/channels/1/overlays`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml
        });
    }

    async getOverlayText(overlayId: string) {
        const response = await this.request({
            method: 'GET',
            url: `http://${this.ip}//ISAPI/System/Video/inputs/channels/1/overlays/text/${overlayId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
        });
        const json = await xml2js.parseStringPromise(response.body) as TextOverlayRoot;

        return { json, xml: response.body };
    }

    async updateOverlayText(overlayId: string, entry: TextOverlayRoot) {
        const builder = new xml2js.Builder();
        const xml = builder.buildObject(entry);

        await this.request({
            method: 'PUT',
            url: `http://${this.ip}//ISAPI/System/Video/inputs/channels/1/overlays/text/${overlayId}`,
            responseType: 'text',
            headers: {
                'Content-Type': 'application/xml',
            },
            body: xml
        });
    }
}