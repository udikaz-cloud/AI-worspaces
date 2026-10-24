// Runs isolated and sandboxed; only the navigator patch below executes in the page.
const { contextBridge } = require('electron');

const identityArg = process.argv.find((arg) => arg.startsWith('--aiw-chrome-identity='));

if (identityArg) {
  contextBridge.executeInMainWorld({
    func: (identity) => {
      const { chromeVersion, chromeMajor, platformName, architecture, userAgent } = identity;
      const brands = [
        { brand: 'Google Chrome', version: chromeMajor },
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Not_A Brand', version: '24' }
      ];
      const fullVersionList = brands.map((entry) => ({
        brand: entry.brand,
        version: entry.brand === 'Not_A Brand' ? '24.0.0.0' : chromeVersion
      }));
      const userAgentData = {
        brands,
        mobile: false,
        platform: platformName,
        toJSON() {
          return { brands, mobile: false, platform: platformName };
        },
        getHighEntropyValues() {
          return Promise.resolve({
            brands,
            fullVersionList,
            mobile: false,
            platform: platformName,
            architecture,
            bitness: '64',
            model: '',
            platformVersion: '15.0.0',
            uaFullVersion: chromeVersion,
            wow64: false
          });
        }
      };

      for (const target of [Navigator.prototype, window.navigator]) {
        Object.defineProperty(target, 'userAgent', { get: () => userAgent });
        Object.defineProperty(target, 'appVersion', { get: () => userAgent.replace(/^Mozilla\//, '') });
        Object.defineProperty(target, 'vendor', { get: () => 'Google Inc.' });
        Object.defineProperty(target, 'userAgentData', { get: () => userAgentData });
      }
    },
    args: [JSON.parse(identityArg.slice('--aiw-chrome-identity='.length))]
  });
}
