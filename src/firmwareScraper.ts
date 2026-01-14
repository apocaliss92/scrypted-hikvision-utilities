import * as https from 'https';
import * as url from 'url';

const PORTAL_HOST = 'www.hikvisioneurope.com';
const FIRMWARE_ROOT_PATH = '/portal/?dir=portal/Technical%20Materials/00%20%20Network%20Camera/00%20%20Product%20Firmware';

interface FirmwareInfo {
    version: string;
    buildDate: string;
    downloadUrl: string;
    description: string;
}

export async function checkHikvisionEuropeFirmware(model: string): Promise<FirmwareInfo | null> {
    try {
        // 1. Get the list of platform directories
        const rootHtml = await fetchUrl(`http://${PORTAL_HOST}${FIRMWARE_ROOT_PATH}`);
        const platformDir = findPlatformDirectory(rootHtml, model);

        if (!platformDir) {
            console.log(`No platform directory found for model ${model}`);
            return null;
        }

        // 2. Get the list of versions in the platform directory
        const platformPath = `/portal/?dir=${encodeURIComponent(platformDir)}`;
        const platformHtml = await fetchUrl(`http://${PORTAL_HOST}${platformPath}`);
        
        // 3. Find the latest version
        const latest = findLatestVersion(platformHtml, platformDir);
        
        return latest;

    } catch (error) {
        console.error('Error checking firmware:', error);
        return null;
    }
}

function fetchUrl(requestUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(requestUrl);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.path,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Handle redirect
                fetchUrl(res.headers.location).then(resolve).catch(reject);
                return;
            }

            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

function findPlatformDirectory(html: string, model: string): string | null {
    // Extract numeric part of model: DS-2CD2043G0-I -> 2043
    // DS-2CD2T87G2-L -> 2T87 (maybe?) usually it's the 4 digits after 2CD
    // Let's try to be flexible.
    
    // Common patterns:
    // DS-2CD2043G0-I -> 2043
    // DS-2CD2143G0-I -> 2143
    // DS-2CD2347G2-L -> 2347
    
    const modelMatch = model.match(/2CD(\d{4})/);
    if (!modelMatch) return null;
    
    const modelNumber = modelMatch[1]; // e.g. 2043

    // The portal HTML contains links like: <a href="?dir=portal/Technical%20Materials/..." ...>G1 platform (DS-2CD2XX5 2XX3...)</a>
    // We need to parse these links and text.
    
    // Regex to find directory links
    const linkRegex = /<a href="\?dir=([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
        const dirPath = match[1]; // portal/Technical Materials/...
        const dirName = match[2]; // G1 platform (DS-2CD2XX5 2XX3...)
        
        if (isModelMatch(dirName, modelNumber)) {
            return decodeURIComponent(dirPath);
        }
    }
    
    return null;
}

function isModelMatch(dirName: string, modelNumber: string): boolean {
    // Check if the directory name contains a pattern matching the model number
    // Example dirName: "G1 platform (DS-2CD2XX5 2XX3 G0)"
    // modelNumber: "2043"
    
    // We look for patterns like 2XX3 in the dirName
    const patterns = dirName.match(/\d[X\d]{3}/g); // Matches 2XX3, 2043, etc.
    
    if (!patterns) return false;
    
    for (const pattern of patterns) {
        // Convert 2XX3 to regex ^2\d\d3$
        const regexStr = pattern.replace(/X/g, '\\d');
        const regex = new RegExp(`^${regexStr}$`);
        if (regex.test(modelNumber)) {
            return true;
        }
    }
    
    return false;
}

function findLatestVersion(html: string, platformDir: string): FirmwareInfo | null {
    // Look for version folders
    // Format: V5.5.80_build180911
    
    const linkRegex = /<a href="\?dir=([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    let latest: FirmwareInfo | null = null;
    
    while ((match = linkRegex.exec(html)) !== null) {
        const dirPath = match[1];
        const dirName = match[2];
        
        // Check if it looks like a version folder
        const versionMatch = dirName.match(/V(\d+\.\d+\.\d+)_?(\d{6})?/i);
        
        if (versionMatch) {
            const version = versionMatch[1];
            const date = versionMatch[2] || '000000';
            
            if (!latest || compareVersions(version, date, latest)) {
                latest = {
                    version: version,
                    buildDate: date,
                    downloadUrl: `http://${PORTAL_HOST}/portal/?dir=${encodeURIComponent(dirPath)}`, // This is just the folder, user needs to click file
                    description: `Found version ${version} (${date})`
                };
            }
        }
    }
    
    return latest;
}

function compareVersions(v1: string, d1: string, current: FirmwareInfo): boolean {
    // Date takes precedence
    if (d1 > current.buildDate) return true;
    if (d1 < current.buildDate) return false;
    
    // Then version
    return v1 > current.version;
}
