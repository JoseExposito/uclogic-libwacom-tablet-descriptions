import * as child_process from 'child_process';
import * as fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { rimraf } from 'rimraf';
import { URL } from 'url';
import * as util from 'util';

const DOWNLOADS_PATH = 'downloads';
const TMP_PATH = path.resolve(DOWNLOADS_PATH, 'tmp');
const RESULTS_PATH = 'results';
const SVGS_PATH = path.resolve(RESULTS_PATH, 'layouts');

const HUION_VENDOR = 'huion';
const GAOMON_VENDOR = 'gaomon';

const HUION_DRIVER_URL_15_0_0_89 = 'https://driverdl.huion.com/driver/Linux/HuionTablet_v15.0.0.89.202205241352.x86_64.deb';
const HUION_DRIVER_URL_15_0_0_103 = 'https://driverdl.huion.com/driver/X10_G930L_Q630M/HuionTablet_v15.0.0.103.202208301443.x86_64.deb';
const HUION_DRIVER_URL_15_0_0_121 = 'https://driverdl.huion.com/driver/Linux/HuionTablet_v15.0.0.121.202301131103.x86_64.deb';
const GAOMON_DRIVER_URL_16_0_0_05 = 'https://driver.gaomon.net/Driver/Linux/GaomonTablet_LinuxDriver_v16.0.0.05.deb';
const GAOMON_DRIVER_URL_16_0_0_07 = 'https://driver.gaomon.net/Driver/PD1161/GaomonTablet_LinuxDriver_v16.0.0.07.x86_64.deb';
const GAOMON_DRIVER_URL_16_0_0_12 = 'https://driver.gaomon.net/Driver/Linux/GaomonTablet_LinuxDriver_v16.0.0.12.x86_64.deb';
const GAOMON_DRIVER_URL_16_0_0_26 = 'https://driver.gaomon.net/Driver/WH851/GaomonTablet_LinuxDriver_v16.0.0.26.x86_64.deb';

const downloadDriver = async (driverUrl) => {
    const filename = path.basename(new URL(driverUrl).pathname);
    const destination = path.resolve(DOWNLOADS_PATH, filename);

    if (!fs.existsSync(DOWNLOADS_PATH)) {
        fs.mkdirSync(DOWNLOADS_PATH);
    }

    if (fs.existsSync(destination)) {
        console.log(`File "${destination}" already exists, not downloading it again`);
        return destination;
    }

    const res = await fetch(driverUrl);
    const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
    await finished(Readable.fromWeb(res.body).pipe(fileStream));

    return destination;
}

const extractDriver = async (driverPath) => {
    if (fs.existsSync(TMP_PATH)) {
        await rimraf(TMP_PATH);
    }
    fs.mkdirSync(TMP_PATH);

    // For the sake of simplicity, use system `ar` and `tar` commands
    const exec = util.promisify(child_process.exec);
    await exec(`ar x --output ${TMP_PATH} ${driverPath}`);
    await exec(`tar -xf ${path.resolve(TMP_PATH, 'data.tar.xz')} -C ${TMP_PATH}`);
}

const getDeviceMatch = (firmware) => (
    `usb|256c|006e||${firmware};usb|256c|006d||${firmware};usb|256c|006f||${firmware};usb|256c|0064||${firmware};`
);

const getTabletName = (productName) => (
    productName
        .replaceAll('（', ' (')
        .replaceAll('）', ')')
        .replaceAll('&', '-')
        .replaceAll('|', '-')
);

const getTabletId = (vendor, productName) => (
    vendor + '-' + productName
        .toLowerCase()
        .replaceAll('huion ', '')
        .replaceAll('gaomon ', '')
        .replaceAll('(', '')
        .replaceAll(')', '')
        .replaceAll('（', '-')
        .replaceAll('）', '')
        .replaceAll('/', '-')
        .replaceAll('&', '-')
        .replaceAll('|', '-')
        .replaceAll('  ', ' ')
        .replaceAll(' ', '-')
);

const generateTabletDescriptionFile = (vendor, firmware, values) => {
    const buttonChars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
    const evdevCodes = ['BTN_0', 'BTN_1', 'BTN_2', 'BTN_3', 'BTN_4', 'BTN_5', 'BTN_6', 'BTN_7', 'BTN_8', 'BTN_9', 'BTN_SOUTH', 'BTN_EAST', 'BTN_C', 'BTN_NORTH', 'BTN_WEST', 'BTN_Z', 'BTN_TL', 'BTN_TR', 'BTN_TL2', 'BTN_TR2'];

    const name = getTabletName(values.ProductName);
    const modelName = name.replaceAll(/huion /gi, '').replaceAll(/gaomon /gi, '');
    const numButtons = values.HBUTTON ? Object.keys(values.HBUTTON).length : 0;
    const numTouchStrips = values.MBUTTON ? Object.keys(values.MBUTTON).length : 0;
    
    let tabletClass = '';
    let integratedIn = '';
    let reversible = true;

    if (firmware.includes("_T")) {
        tabletClass = 'Bamboo';
    } else if (firmware.includes("_M")) {
        tabletClass = 'Cintiq';
        integratedIn = 'Display';
        reversible = false;
    } else {
        console.log(`### Unknown firmware ${firmware}, settings class to Bamboo ###`);
        tabletClass = 'Bamboo';
    }

    // Log unknown entries for investigation
    Object.keys(values).forEach((key) => {
        if (key != 'ProductName' && key != 'HBUTTON' && key != 'MBUTTON') {
            console.log(`### Unknown value "${key}" for firmware "${firmware}" ###`);
        }
    });

    const tabletDescription =
`# This tablet description file has been generated using an automated tool:
# https://github.com/JoseExposito/uclogic-libwacom-tablet-descriptions
# If you own this tablet, please improve it.
#
# sysinfo missing - if you own this device please provide it. See this link
# for details: https://github.com/linuxwacom/libwacom/wiki/Adding-a-new-device

[Device]
Name=${name}
ModelName=${modelName}
Class=${tabletClass}
# Product ID is unknown, please fix
DeviceMatch=${getDeviceMatch(firmware)}
Width=9  # autogenerated value, please fix
Height=6  # autogenerated value, please fix
Layout=${getTabletId(vendor, values.ProductName)}.svg
Styli=@generic-no-eraser;
IntegratedIn=${integratedIn}

[Features]
NumStrips=${numTouchStrips}
NumRings=0
Reversible=${reversible}
Stylus=true
Touch=false
TouchSwitch=false

[Buttons]
Left=${buttonChars.slice(0, numButtons).join(';')}
EvdevCodes=${evdevCodes.slice(0, numButtons).join(';')}
`;

    return tabletDescription;
};

const generateTabletSvg = (vendor, tabletName, cfg) => {
    const buttonChars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];

    return `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg"
        version="1.1"
        style="color:#000000;stroke:#7f7f7f;fill:none;stroke-width:.25;font-size:8"
        id="${getTabletId(vendor, tabletName)}"
        width="${cfg.imageWidth}"
        height="${cfg.imageHeight}">
    <title id="title">${tabletName}</title>
    <rect x="${cfg.frame.x}" y="${cfg.frame.y}" width="${cfg.frame.w}" height="${cfg.frame.h}" />
    ${cfg.buttons.map(({ x, y, w, h }, index) => {
        const btn = buttonChars.at(index);

        return `
            <g>
                <rect id="Button${btn}"
                      class="${btn} Button"
                      x="${x}"
                      y="${y}"
                      width="${w}"
                      height="${h}" />
                <text id="Label${btn}"
                      class="${btn} Label"
                      x="${x + w / 2 - 2}"
                      y="${y + h / 2 + 2}"
                      style="text-anchor:start;">${btn}</text>
            </g>`;
    }).join('')}
</svg>
`;
};

const saveTabletDescriptionFile = (vendor, firmware, tabletName, tabletDescription) => {
    const filePath = path.resolve(RESULTS_PATH, `${getTabletId(vendor, tabletName)}.tablet`);

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, tabletDescription, 'utf-8');
    } else {
        let newDescription = '';
        const contents = fs.readFileSync(filePath, 'utf-8');
        contents.split('\n').forEach((l) => {
            if (l.startsWith('DeviceMatch=') && !l.includes(firmware)) {
                newDescription += `${l}${getDeviceMatch(firmware)}\n`;
            } else {
                newDescription += `${l}\n`;
            }
        });

        // Remove empty lines and the beginning and end of the description
        newDescription = newDescription.replace(/^\s+|\s+$/g, '');
        newDescription += '\n';

        fs.writeFileSync(filePath, newDescription, 'utf-8');
    }
};

const saveTabletSvg = (vendor, tabletName, tabletSvg) => {
    const filePath = path.resolve(SVGS_PATH, `${getTabletId(vendor, tabletName)}.svg`);
    fs.writeFileSync(filePath, tabletSvg, 'utf-8');
};

const parseStatuImgJs = (vendor) => {
    const jsonPath = path.resolve(TMP_PATH, 'usr', 'lib', `${vendor}tablet`, 'res', 'StatuImg.js');
    const jsonContents = fs.readFileSync(jsonPath, 'utf-8');
    const jsonContentsSanitized = jsonContents.replace('\0', '');
    const json = JSON.parse(jsonContentsSanitized);

    return Object.fromEntries(
        Object.entries(json)
            .filter(([firmware, { ProductName }]) => !!ProductName) // Remove empty product names (pens)
    );
};

const parseLayoutTabletCfg = (vendor, statuImgJs) => {
    // The layout_tablet.cfg is a binary file with the following structure:
    // Header (84 bytes)
    // Configuration (3784 bytes)
    // |- Firmware name (24 bytes)
    // |- Image width (4 bytes)
    // |- Image height (4 bytes)
    // |- Frame start X (4 bytes)
    // |- Frame start Y (4 bytes)
    // |- Frame end X (4 bytes)
    // |- Frame end Y (4 bytes)
    // |- Unknown (16 bytes)
    // |- Button 0 start X (4 bytes)
    // |- Button 0 start Y (4 bytes)
    // |- Button 0 end X (4 bytes)
    // |- Button 0 end Y (4 bytes)
    // |- ... Other buttons
    const headerLength = 84;
    const cfgLength = 3784;
    const firmwareLength = 24;
    const unknownLength = 16;

    // An object with structure:
    // {
    //   Firmware_Name: {
    //     imageWidth,
    //     imageHeight,
    //     frame: { x, y, w, h },
    //     buttons: [{ x, y, w, h }, { x, y, w, h }, ...],
    //   }
    // }
    const result = {};

    const cfgPath = path.resolve(TMP_PATH, 'usr', 'lib', `${vendor}tablet`, 'res', 'layout_tablet.cfg');
    const cfg = fs.readFileSync(cfgPath);

    const numCfgs = (cfg.length - headerLength) / cfgLength;
    if (!Number.isInteger(numCfgs)) {
        throw new Error('layout_tablet.cfg does not have the expected size');
    }

    for (let n = headerLength; n < cfg.length; n += cfgLength) {
        let offset = n;

        const firmwareName = cfg.toString('utf-8', offset, offset + firmwareLength).replaceAll('\0', '');
        offset += firmwareLength;

        const imageWidth = cfg.readInt16LE(offset);
        offset += 4;
        const imageHeight = cfg.readInt16LE(offset);
        offset += 4;

        const frameXStart = cfg.readInt16LE(offset);
        offset += 4;
        const frameYStart = cfg.readInt16LE(offset);
        offset += 4;
        const frameXEnd = cfg.readInt16LE(offset);
        offset += 4;
        const frameYEnd = cfg.readInt16LE(offset);
        offset += 4;

        offset += unknownLength;

        const buttons = [];
        const numButtons = statuImgJs[firmwareName]['HBUTTON']
            ? Object.keys(statuImgJs[firmwareName]['HBUTTON']).length
            : 0;
        for (let b = 0; b < numButtons; b++) {
            const buttonXStart = cfg.readInt16LE(offset);
            offset += 4;
            const buttonYStart = cfg.readInt16LE(offset);
            offset += 4;
            const buttonXEnd = cfg.readInt16LE(offset);
            offset += 4;
            const buttonYEnd = cfg.readInt16LE(offset);
            offset += 4;
            
            buttons.push({
                x: buttonXStart,
                y: buttonYStart,
                w: buttonXEnd - buttonXStart,
                h: buttonYEnd - buttonYStart,
            });
        }

        if (result[firmwareName]) {
            console.log(`### Duplicated firmware ${firmwareName} found in layout_tablet.cfg ###`);
        }

        result[firmwareName] = {
            imageWidth,
            imageHeight,
            frame: {
                x: frameXStart,
                y: frameYStart,
                w: frameXEnd - frameXStart,
                h: frameYEnd - frameYStart,
            },
            buttons,
        };
    }

    return result;
};

const generateTabletDescriptionFiles = (vendor) => {
    const statuImgJs = parseStatuImgJs(vendor);
    const layoutTabletCfg = parseLayoutTabletCfg(vendor, statuImgJs);

    Object.entries(statuImgJs).forEach(([firmware, values]) => {
        const tabletName = getTabletName(values.ProductName);
        const tabletDescription = generateTabletDescriptionFile(vendor, firmware, values);
        const tabletSvg = generateTabletSvg(vendor, tabletName, layoutTabletCfg[firmware]);
        saveTabletDescriptionFile(vendor, firmware, tabletName, tabletDescription);
        saveTabletSvg(vendor, tabletName, tabletSvg);
    });
};

const processDriver = async (vendor, driverUrl) => {
    if (!fs.existsSync(RESULTS_PATH)) {
        fs.mkdirSync(RESULTS_PATH);
    }

    if (!fs.existsSync(SVGS_PATH)) {
        fs.mkdirSync(SVGS_PATH);
    }

    console.log(`Downloading driver from ${driverUrl}`);
    const driverPath = await downloadDriver(driverUrl);

    console.log('Extracting driver');
    await extractDriver(driverPath);

    console.log('Generating tablet description files');
    generateTabletDescriptionFiles(vendor);
};

const main = async () => {
    await processDriver(HUION_VENDOR, HUION_DRIVER_URL_15_0_0_89);
    await processDriver(HUION_VENDOR, HUION_DRIVER_URL_15_0_0_103);
    await processDriver(HUION_VENDOR, HUION_DRIVER_URL_15_0_0_121);
    await processDriver(GAOMON_VENDOR, GAOMON_DRIVER_URL_16_0_0_05);
    await processDriver(GAOMON_VENDOR, GAOMON_DRIVER_URL_16_0_0_07);
    await processDriver(GAOMON_VENDOR, GAOMON_DRIVER_URL_16_0_0_12);
    await processDriver(GAOMON_VENDOR, GAOMON_DRIVER_URL_16_0_0_26);
}

main();
