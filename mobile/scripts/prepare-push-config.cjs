// Public Firebase client configuration only. FCM service-account keys belong in EAS.
const fs = require('node:fs');
const path = require('node:path');
const { pushBuildConfig, validateGoogleServices } = require('../push-build-config.cjs');
const root = path.resolve(__dirname, '..');
const qa = process.env.TAEJANG_APP_VARIANT === 'qa';
const variant = qa ? 'qa' : 'production';
const packageName = 'com.cetin072.taejang.staff' + (qa ? '.qa' : '');
const encoded = process.env.GOOGLE_SERVICES_JSON_BASE64 || '';
if (encoded) {
  const json = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  validateGoogleServices(json, packageName);
  const file = path.join(root, '.push', 'google-services-' + variant + '.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json), { mode: 0o600 });
  process.env.ANDROID_GOOGLE_SERVICES_FILE = file;
}
const config = pushBuildConfig(process.env, packageName, root);
if (process.env.GITHUB_ENV && config.configured) {
  fs.appendFileSync(process.env.GITHUB_ENV, 'ANDROID_GOOGLE_SERVICES_FILE=' + config.googleServicesFile + '\n');
}
const message = config.configured
  ? 'Push client configuration validated for ' + packageName + '. Receipt/device delivery is still unverified.'
  : 'Push NOT configured: this QA APK cannot validate remote push. Configure EAS + Firebase and rebuild.';
console.log(message);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
