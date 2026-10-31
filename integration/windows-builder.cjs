const fs = require('node:fs');
const YAML = require('yaml');
const config = YAML.parse(fs.readFileSync('electron-builder.yml', 'utf8'));

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
config.publish = null;
config.win.signAndEditExecutable = false;
module.exports = config;
