const fs = require('fs');
const path = require('path');
const cliProgress = require('cli-progress');
const { exit } = require('process');
const axios = require('axios');

const downloadFile = require('./modules/download');
const verifyChecksum = require('./modules/checksum');
const extractZip = require('./modules/extract');
const fetchVersion = require('./modules/version');
const { deleteFolderRecursive } = require('./modules/fileutils');
const { folderMappings, AppSettings } = require('./modules/constants');
const logger = require('./modules/logger');
const fetchPreviousVersion = require('./modules/fpv');

const CONFIG_FILE_PATH = './config.json';
const DEFAULT_CONFIG = {
  deleteExistingFolders: false,
  forceUpdate: false,
};

let config = { ...DEFAULT_CONFIG };

const colors = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
};

const clearTerminal = () => {
  console.clear();
};

const asciiArt = `
██████  ██████  ██   ██  ██████ ██      ██ 
██   ██ ██   ██  ██ ██  ██      ██      ██ 
██████  ██████    ███   ██      ██      ██ 
██   ██ ██   ██  ██ ██  ██      ██      ██ 
██   ██ ██████  ██   ██  ██████ ███████ ██ v1.0.6                                                                                       
Download and launch Roblox versions using just the command line.
`;

const mainMenu = `
${colors.BLUE}${asciiArt}${colors.RESET}
${colors.CYAN}1. Download latest version/update${colors.RESET}
${colors.CYAN}2. Download the last LIVE version (downgrade)${colors.RESET}
${colors.CYAN}3. Download a custom version hash${colors.RESET}
${colors.CYAN}4. Download from a specific channel${colors.RESET}
${colors.CYAN}5. Launch Roblox${colors.RESET}
${colors.CYAN}6. Launch Roblox with args${colors.RESET}
${colors.GREEN}7. Settings${colors.RESET}
${colors.RED}8. Exit${colors.RESET}
`;

const loadConfig = () => {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    const rawData = fs.readFileSync(CONFIG_FILE_PATH);
    config = JSON.parse(rawData);
  } else {
    saveConfig();
  }
};

const saveConfig = () => {
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
};

const showSettingsMenu = async () => {
  clearTerminal();
  console.log(`${colors.MAGENTA}Settings Menu${colors.RESET}`);
  console.log(`${colors.GREEN}1. Toggle delete existing folders (Current: ${config.deleteExistingFolders})${colors.RESET}`);
  console.log(`${colors.YELLOW}2. Toggle force update (Current: ${config.forceUpdate})${colors.RESET}`);
  console.log(`${colors.RED}3. Back to main menu${colors.RESET}`);
  const choice = await prompt('Select an option: ');

  switch (choice) {
    case '1':
      config.deleteExistingFolders = !config.deleteExistingFolders;
      console.log(`${colors.BLUE}Delete existing folders set to: ${config.deleteExistingFolders}${colors.RESET}`);
      saveConfig();
      await prompt('Press Enter to continue...');
      showSettingsMenu();
      break;
    case '2':
      config.forceUpdate = !config.forceUpdate;
      console.log(`${colors.BLUE}Force update set to: ${config.forceUpdate}${colors.RESET}`);
      saveConfig();
      await prompt('Press Enter to continue...');
      showSettingsMenu();
      break;
    case '3':
      main();
      break;
    default:
      console.log(colors.RED + 'Invalid option selected. Please try again.' + colors.RESET);
      showSettingsMenu();
      break;
  }
};

const main = async () => {
  clearTerminal();
  console.log(mainMenu);
  const choice = await prompt('Select an option: ');

  switch (choice) {
    case '1':
      clearTerminal();
      await downloadLatestVersion();
      break;
    case '2':
      clearTerminal();
      const previousVersion = await fetchPreviousVersion();
      if (previousVersion) {
        await downloadVersion(previousVersion);
      }
      break;
    case '3':
      clearTerminal();
      const versionHash = await prompt('Enter the custom version hash: ');
      await downloadCustomVersion(versionHash);
      break;
    case '4':
      clearTerminal();
      const channel = await prompt('Enter the channel name: ');
      await downloadFromChannel(channel);
      break;
    case '5':
      clearTerminal();
      await launchRoblox();
      break;
    case '6':
      clearTerminal();
      await launchRoblox(true);
      break;
    case '7':
      clearTerminal();
      await showSettingsMenu();
      break;
    case '8':
      clearTerminal();
      console.log(colors.BLUE + 'Exiting...' + colors.RESET);
      exit(0);
      break;
    default:
      clearTerminal();
      console.log(colors.RED + 'Invalid option selected. Please try again.' + colors.RESET);
      main();
      break;
  }
};

const downloadLatestVersion = async () => {
  logger.info('Fetching the latest version of Roblox from LIVE Channel...');
  logger.info('--> https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer/channel/live/');
  const version = await fetchVersion();
  logger.info(`Version: ${version}`);

  await downloadVersion(version);
};

const downloadCustomVersion = async (version) => {
  logger.info(`Fetching the custom version: ${version}`);

  await downloadVersion(version);
};

const downloadFromChannel = async (channel) => {
  logger.info(`Fetching the latest version of Roblox from channel: ${channel}`);
  const versionUrl = `https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer/channel/${channel}/`;

  try {
    const response = await axios.get(versionUrl);
    const version = response.data.clientVersionUpload;
    logger.info(`Version from channel ${channel}: ${version}`);

    await downloadVersion(version);
  } catch (error) {
    logger.error(`Failed to fetch version from channel ${channel}: ${error.message}`);
  }
};

const downloadVersion = async (version) => {
  clearTerminal();
  const versionFolder = version.startsWith('version-') ? version : `version-${version}`;
  const dumpDir = path.join(__dirname, versionFolder);

  if (fs.existsSync(dumpDir) && !config.forceUpdate) {
    logger.info(`Version ${version} is already downloaded.`);
    exit(0);
  }

  if (fs.existsSync(dumpDir) && config.deleteExistingFolders) {
    logger.info(`Deleting existing folder: ${dumpDir}`);
    deleteFolderRecursive(dumpDir);
  }

  const baseUrl = `https://setup.rbxcdn.com/${version}-`;
  const manifestUrl = `${baseUrl}rbxPkgManifest.txt`;

  fs.mkdirSync(dumpDir, { recursive: true });
  logger.info(`Fetching manifest from ${manifestUrl}...`);
  const response = await axios.get(manifestUrl);
  const manifestContent = response.data.trim().split('\n');

  const firstLine = manifestContent[0].trim();
  if (firstLine !== 'v0') {
    logger.error(`Unexpected manifest version: ${firstLine}. Expected 'v0'.`);
    return;
  } else {
    logger.info(`Manifest version: ${firstLine}`);
  }

  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

  for (let i = 1; i < manifestContent.length; i += 4) {
    const fileName = manifestContent[i].trim();
    const checksum = manifestContent[i + 1].trim();
    const compressedSize = parseInt(manifestContent[i + 2], 10);
    const uncompressedSize = parseInt(manifestContent[i + 3], 10);

    if (fileName.endsWith('.zip') || fileName.endsWith('.exe')) {
      const packageUrl = `${baseUrl}${fileName}`;
      const filePath = `${dumpDir}/${fileName}`;

      logger.info(`Downloading ${fileName} from ${packageUrl}...`);
      await downloadFile(packageUrl, filePath, progressBar);

      logger.info(`Verifying ${fileName}...`);
      const isChecksumValid = await verifyChecksum(filePath, checksum);

      if (isChecksumValid) {
        logger.info(`${fileName} downloaded and verified successfully.`);
        if (fileName.endsWith('.zip')) {
          logger.info(`Extracting ${fileName}...`);
          const extractPath = await extractZip(filePath, dumpDir, folderMappings);
          logger.info(`Cleaning up ${fileName}...`);
          fs.unlinkSync(filePath);
          logger.info(`Deleted ${fileName}.`);
        }
      } else {
        logger.error(`Checksum mismatch for ${fileName}. Deleting file.`);
        fs.unlinkSync(filePath);
      }
    } else {
      logger.info(`Skipping entry: ${fileName}`);
    }
  }

  logger.info(`Creating AppSettings.xml...`);
  fs.writeFileSync(`${dumpDir}/AppSettings.xml`, AppSettings);
  logger.info(`AppSettings.xml created at root.`);

  logger.info(`Roblox ${version} has been successfully downloaded and extracted to ${dumpDir}.`);
  exit(0);
};

const launchRoblox = async (withArgs = false) => {
  const versions = fs.readdirSync(__dirname).filter(f => f.startsWith('version-'));
  if (versions.length === 0) {
    console.log(colors.RED + 'No Roblox versions found in the current directory.' + colors.RESET);
    return;
  }

  console.log(`${colors.MAGENTA}Available Versions:${colors.RESET}`);
  versions.forEach((version, index) => {
    console.log(`${colors.CYAN}${index + 1}. ${version}${colors.RESET}`);
  });

  const versionChoice = await prompt('Select a version (1/2/3...): ');
  const versionIndex = parseInt(versionChoice) - 1;

  if (versionIndex < 0 || versionIndex >= versions.length) {
    console.log(colors.RED + 'Invalid version selected.' + colors.RESET);
    return;
  }

  const selectedVersion = versions[versionIndex];
  const robloxPlayerPath = path.join(__dirname, selectedVersion, 'RobloxPlayerBeta.exe');

  if (!fs.existsSync(robloxPlayerPath)) {
    console.log(colors.RED + `RobloxPlayerBeta.exe not found in ${selectedVersion}` + colors.RESET);
    return;
  }

  let launchArgs = '';
  if (withArgs) {
    launchArgs = await prompt('Enter the launch arguments (e.g., roblox://...): ');
  }

  const childProcess = require('child_process');
  const command = `"${robloxPlayerPath}"`;
  const args = launchArgs.split(' ');

  console.log(colors.GREEN + `Launching Roblox with command: ${command} ${launchArgs}` + colors.RESET);

  const process = childProcess.spawn(command, args, { shell: true, detached: true, stdio: 'ignore' });

  process.unref();

  console.log(colors.GREEN + 'Roblox launched successfully.' + colors.RESET);
};

const prompt = (query) => {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

loadConfig();
main().catch(err => logger.error(err));
