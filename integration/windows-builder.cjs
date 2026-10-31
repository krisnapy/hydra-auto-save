const fs = require('node:fs');
const YAML = require('yaml');
const config = YAML.parse(fs.readFileSync('electron-builder.yml', 'utf8'));

// Keep release compression unchanged unless explicitly comparing a faster build.
const compression = process.env.HYDRA_BUILD_COMPRESSION || 'normal';
if (!['normal', 'store'].includes(compression)) throw new Error('Unknown build compression');
config.compression = compression;

// Keep Hydra's product name/profile so the existing local library is available.
// Use a separate installer identity and executable to avoid replacing its files.
config.appId = 'id.krisnapy.hydra.personalbackup';
config.win.executableName = 'Hydra Personal Backup';
config.win.target = [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }];
config.nsis.artifactName = 'Hydra-Personal-Backup-0.3.0-hydra-${version}-windows-x64-setup.${ext}';
config.nsis.shortcutName = 'Hydra Personal Backup';
config.nsis.uninstallDisplayName = 'Hydra Personal Backup';
config.nsis.deleteAppDataOnUninstall = false;
delete config.nsis.include;
config.portable.artifactName = 'Hydra-Personal-Backup-0.3.0-hydra-${version}-windows-x64-portable.${ext}';
config.extraResources.push({ from: 'Personal-Backup-README.md', to: 'Personal-Backup-README.md' });
config.files.push('!.personal-backup-originals/**', '!personal-backup-builder.cjs');
// This static link input is already compiled into classic-level's addon. The
// discovered 37.5 MiB archive is not loaded by Node at runtime.
config.files.push('!node_modules/classic-level/build/Release/leveldb.lib');
config.publish = null;
config.win.signAndEditExecutable = false;
module.exports = config;
