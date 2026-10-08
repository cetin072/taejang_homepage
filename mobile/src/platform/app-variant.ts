import Constants from 'expo-constants';

export type TaejangAppVariant = 'production' | 'qa';

export function currentAppVariant(): TaejangAppVariant {
  return Constants.expoConfig?.extra?.appVariant === 'qa' ? 'qa' : 'production';
}

export const isQaApp = currentAppVariant() === 'qa';

export function appVariantLabel() {
  return isQaApp ? '태장 QA' : '태장';
}
