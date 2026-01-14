import { checkHikvisionEuropeFirmware } from "./firmwareScraper";

async function run() {
    const model = "DS-2DE2A404IW-DE3/W";
    console.log(`Checking firmware for ${model}...`);
    const result = await checkHikvisionEuropeFirmware(model);
    console.log("Result:", result);
}

run();