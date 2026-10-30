// Runs isolated and sandboxed; only the patches below execute in the page.
const { contextBridge } = require('electron');

// Electron exposes every pasted screenshot as a file named "image.png" backed by
// one temporary clipboard file. ChatGPT keys the upload on that name, so the
// first image finishes and the next one stays on "Uploading image.png" until a
// new chat throws the composer away. Copy the bytes out and give each paste its
// own name before the page reads the clipboard.
contextBridge.executeInMainWorld({
  func: () => {
    function extensionFor(type) {
      const subtype = type.split('/')[1] || 'png';
      return subtype === 'jpeg' ? 'jpg' : subtype.split('+')[0];
    }

    function bytesOf(file) {
      const url = URL.createObjectURL(file);
      try {
        const request = new XMLHttpRequest();
        request.open('GET', url, false);
        request.overrideMimeType('text/plain; charset=x-user-defined');
        request.send();
        const text = request.responseText || '';
        const bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i += 1) {
          bytes[i] = text.charCodeAt(i) & 0xff;
        }
        return bytes;
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    function normalizeClipboard(data) {
      if (!data || data.files.length === 0 || data.__aiwNormalized) {
        return;
      }

      const images = [...data.files].filter((file) => file.type.startsWith('image/'));
      if (images.length === 0) {
        return;
      }

      const stamped = images.map((file, index) => {
        const type = file.type || 'image/png';
        const bytes = bytesOf(file);
        return new File(
          [bytes.byteLength ? bytes : file],
          `image-${Date.now()}-${index}.${extensionFor(type)}`,
          { type }
        );
      });
      const transfer = new DataTransfer();
      let imageIndex = 0;
      for (const file of data.files) {
        transfer.items.add(file.type.startsWith('image/') ? stamped[imageIndex++] : file);
      }
      for (const item of data.items) {
        if (item.kind !== 'string' || !item.type) {
          continue;
        }

        try {
          transfer.items.add(data.getData(item.type), item.type);
        } catch {
          // Some clipboard string types cannot be re-added. The image still pastes.
        }
      }

      const types = [...new Set([...stamped.map((file) => file.type), ...data.types])];
      Object.defineProperty(data, 'items', { configurable: true, get: () => transfer.items });
      Object.defineProperty(data, 'files', { configurable: true, get: () => transfer.files });
      Object.defineProperty(data, 'types', { configurable: true, get: () => types });
      Object.defineProperty(data, '__aiwNormalized', { value: true });
    }

    document.addEventListener('paste', (event) => {
      try {
        normalizeClipboard(event.clipboardData);
      } catch {
        // Leave the original paste alone if the clipboard object cannot be patched.
      }
    }, true);

    document.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'insertFromPaste') {
        return;
      }

      try {
        normalizeClipboard(event.dataTransfer);
      } catch {
        // The paste event still carries the image when this clipboard cannot be patched.
      }
    }, true);
  }
});

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
