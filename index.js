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

const DRIVER_URL_15_0_0_89 = 'https://driverdl.huion.com/driver/Linux/HuionTablet_v15.0.0.89.202205241352.x86_64.deb';
const DRIVER_URL_15_0_0_103 = 'https://driverdl.huion.com/driver/X10_G930L_Q630M/HuionTablet_v15.0.0.103.202208301443.x86_64.deb';
const DRIVER_URL_15_0_0_121 = 'https://driverdl.huion.com/driver/Linux/HuionTablet_v15.0.0.121.202301131103.x86_64.deb';

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

const generateTabletDescriptionFile = (firmware, values) => {
    const buttonChars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'];
    const evdevCodes = ['BTN_0', 'BTN_1', 'BTN_2', 'BTN_3', 'BTN_4', 'BTN_5', 'BTN_6', 'BTN_7', 'BTN_8', 'BTN_9', 'BTN_SOUTH', 'BTN_EAST', 'BTN_C', 'BTN_NORTH', 'BTN_WEST', 'BTN_Z', 'BTN_TL', 'BTN_TR', 'BTN_TL2', 'BTN_TR2'];

    const name = values.ProductName;
    const numButtons = values.HBUTTON ? Object.keys(values.HBUTTON).length : 0;
    const numTouchStrips = values.MBUTTON ? Object.keys(values.MBUTTON).length : 0;
    
    let tabletClass = '';
    let integratedIn = '';
    let reversible = true;

    if (firmware.startsWith("HUION_T")) {
        tabletClass = 'Bamboo';
    } else if (firmware.startsWith("HUION_M")) {
        tabletClass = 'Cintiq';
        integratedIn = 'Display';
        reversible = false;
    } else {
        console.log('### Unknown firmware prefix, settings class to Bamboo ###');
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

[Device]
Name=${name}
ModelName=
Class=${tabletClass}
DeviceMatch=usb|256c|006e||${firmware};usb|256c|006d||${firmware};
Width=
Height=
Layout=
Styli=@generic-no-eraser;
IntegratedIn=${integratedIn}

[Features]
NumStrips=${numTouchStrips}
Reversible=${reversible}
Ring=false
Stylus=true
Touch=false
TouchSwitch=false

[Buttons]
Left=${buttonChars.slice(0, numButtons).join(';')}
EvdevCodes=${evdevCodes.slice(0, numButtons).join(';')}
`;

    return {
        tabletName: name,
        tabletDescription,
    }
};

const saveTabletDescriptionFile = (resultsPath, {tabletName, tabletDescription}) => {
    const filename = tabletName
        .toLowerCase()
        .replaceAll('huion ', '')
        .replaceAll('(', '')
        .replaceAll(')', '')
        .replaceAll('/', '-')
        .replaceAll('&', '-')
        .replaceAll('  ', ' ')
        .replaceAll(' ', '-');
    
    let version = 1;
    let filePath = path.resolve(resultsPath, `huion-${filename}.tablet`);
    while (fs.existsSync(filePath)) {
        filePath = path.resolve(resultsPath, `huion-${filename}-v${version}.tablet`);
        version++;
    }

    fs.writeFileSync(filePath, tabletDescription, 'utf-8');
};

const generateTabletDescriptionFiles = (driverUrl) => {
    const filename = path.basename(new URL(driverUrl).pathname);
    const destination = path.resolve(RESULTS_PATH, filename);

    if (!fs.existsSync(RESULTS_PATH)) {
        fs.mkdirSync(RESULTS_PATH);
    }

    if (!fs.existsSync(destination)) {
        fs.mkdirSync(destination);
    }

    const huionJsonPath = path.resolve(TMP_PATH, 'usr', 'lib', 'huiontablet', 'res', 'StatuImg.js');
    const huionJsonContents = fs.readFileSync(huionJsonPath, 'utf-8');
    const huionJsonContentsSanitized = huionJsonContents.replace('\0', '');
    const huionJson = JSON.parse(huionJsonContentsSanitized);

    Object.entries(huionJson)
        .filter(([firmware, { ProductName }]) => !!ProductName) // Remove empty product names
        .forEach(([firmware, values]) => {
            const res = generateTabletDescriptionFile(firmware, values);
            saveTabletDescriptionFile(destination, res);
        });
};

const main = async (driverUrl) => {
    console.log(`Downloading driver from ${driverUrl}`);
    const driverPath = await downloadDriver(driverUrl);

    console.log('Extracting driver');
    await extractDriver(driverPath);

    console.log('Generating tablet description files');
    generateTabletDescriptionFiles(driverUrl);
}

main(DRIVER_URL_15_0_0_121);
