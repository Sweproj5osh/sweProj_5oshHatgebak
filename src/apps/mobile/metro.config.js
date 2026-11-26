// The Metro bundler for the one app (ADR-17, ADR-18). Expo's defaults already know the npm workspace; the app also
// bundles the shared client and the one server file it imports (src/server/shared/request-id.ts), which live
// outside this folder.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const repository = path.resolve(__dirname, '..', '..', '..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.join(repository, 'src', 'apps', 'shared-client'), path.join(repository, 'src', 'server', 'shared')];

module.exports = config;
