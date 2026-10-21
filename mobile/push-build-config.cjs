const fs = require('node:fs');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateGoogleServices(value, packageName) {
  if (!value || value.type === 'service_account' || value.private_key) throw new Error('PUSH_EXPECTED_PUBLIC_GOOGLE_SERVICES');
  const clients = Array.isArray(value.client) ? value.client : [];
  if (!value.project_info?.project_number || !clients.some(item =>
    item.client_info?.android_client_info?.package_name === packageName)) {
    throw new Error('PUSH_GOOGLE_SERVICES_PACKAGE_MISMATCH');
  }
}
function pushBuildConfig(env, androidPackage, root = __dirname) {
  const qa = env.TAEJANG_APP_VARIANT === 'qa';
  const projectId = String(qa ? env.EXPO_PUBLIC_EAS_PROJECT_ID_QA || '' : env.EXPO_PUBLIC_EAS_PROJECT_ID || '').trim();
  const file = String(env.ANDROID_GOOGLE_SERVICES_FILE || '').trim();
  const required = env.TAEJANG_PUSH_CONFIG_REQUIRED === 'true';
  if (!projectId && !file && !required) return { configured: false };
  if (!UUID.test(projectId)) throw new Error('PUSH_EAS_PROJECT_ID_REQUIRED');
  if (!file || !fs.existsSync(path.resolve(root, file))) throw new Error('PUSH_GOOGLE_SERVICES_FILE_REQUIRED');
  validateGoogleServices(JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8')), androidPackage);
  return { configured: true, projectId, googleServicesFile: file };
}
module.exports = { pushBuildConfig, validateGoogleServices };
