const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo's generated Android project signs `release` with debug.keystore unless a
 * project supplies a release signing config. A debug-signed release artifact is
 * not a valid Google Play upload. Keep the generated release variant unsigned
 * by default so the approved Play workflow must inject the protected upload key.
 */
module.exports = function withReleaseUploadSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const before = config.modResults.contents;
    const after = before.replace(
      /(release \{\r?\n\s*\/\/ Caution![\s\S]*?)\s*signingConfig signingConfigs\.debug\r?\n/,
      '$1\n            // Signing is injected only by the protected Google Play AAB workflow.\n'
    );

    if (after === before) {
      throw new Error('Expected Expo release debug signing config was not found. Refuse to create an ambiguous release build.');
    }

    config.modResults.contents = after;
    return config;
  });
};
