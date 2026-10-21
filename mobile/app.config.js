const QA_PACKAGE = 'com.cetin072.taejang.staff.qa';
const QA_SCHEME = 'taejangstaffqa';
const QA_ICON_BACKGROUND = '#F3E7A7';
const { pushBuildConfig } = require('./push-build-config.cjs');

module.exports = ({ config }) => {
  const qa = String(process.env.TAEJANG_APP_VARIANT || '').trim().toLowerCase() === 'qa';
  const android = { ...(config.android || {}) };
  const extra = { ...(config.extra || {}) };
  // EAS CLI may write production defaults into app.json. Never let QA silently
  // inherit those credentials/config paths when its own pair is absent.
  delete android.googleServicesFile;
  delete extra.eas;
  const adaptiveIcon = android.adaptiveIcon || {};
  const androidPackage = qa ? QA_PACKAGE : android.package;
  const push = pushBuildConfig(process.env, androidPackage);

  return {
    ...config,
    name: qa ? '태장 QA' : config.name,
    scheme: qa ? QA_SCHEME : config.scheme,
    android: {
      ...android,
      package: androidPackage,
      ...(push.configured ? { googleServicesFile: push.googleServicesFile } : {}),
      adaptiveIcon: {
        ...adaptiveIcon,
        backgroundColor: qa ? QA_ICON_BACKGROUND : adaptiveIcon.backgroundColor,
      },
    },
    extra: {
      ...extra,
      appVariant: qa ? 'qa' : 'production',
      pushConfigured: push.configured,
      ...(push.configured ? { eas: { projectId: push.projectId } } : {}),
    },
  };
};
