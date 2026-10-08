const QA_PACKAGE = 'com.cetin072.taejang.staff.qa';
const QA_SCHEME = 'taejangstaffqa';
const QA_ICON_BACKGROUND = '#F3E7A7';

module.exports = ({ config }) => {
  const qa = String(process.env.TAEJANG_APP_VARIANT || '').trim().toLowerCase() === 'qa';
  const android = config.android || {};
  const adaptiveIcon = android.adaptiveIcon || {};

  return {
    ...config,
    name: qa ? '태장 QA' : config.name,
    scheme: qa ? QA_SCHEME : config.scheme,
    android: {
      ...android,
      package: qa ? QA_PACKAGE : android.package,
      adaptiveIcon: {
        ...adaptiveIcon,
        backgroundColor: qa ? QA_ICON_BACKGROUND : adaptiveIcon.backgroundColor,
      },
    },
    extra: {
      ...(config.extra || {}),
      appVariant: qa ? 'qa' : 'production',
    },
  };
};
