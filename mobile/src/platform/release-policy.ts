import Constants from 'expo-constants';

import type { PublicMobileReleasePolicy } from './config';

export type InstalledAppVersion = { version: string; versionCode: number | null };
export type UpdateDecision = 'none' | 'optional' | 'forced';

function semanticParts(value: string | null | undefined) {
  if (!value || !/^\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) return null;
  const suffixIndex = value.search(/[-+]/);
  const core = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  return { parts: core.split('.').map(Number), prerelease: suffixIndex !== -1 && value[suffixIndex] === '-' };
}

export function compareSemanticVersions(left: string | null | undefined, right: string | null | undefined) {
  const leftParts = semanticParts(left);
  const rightParts = semanticParts(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts.parts[index] || 0) - (rightParts.parts[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  if (leftParts.prerelease === rightParts.prerelease) return 0;
  return leftParts.prerelease ? -1 : 1;
}

function olderThan(installed: InstalledAppVersion, version: string | null, versionCode: number | null) {
  if (versionCode !== null && installed.versionCode !== null) return installed.versionCode < versionCode;
  const semantic = compareSemanticVersions(installed.version, version);
  return semantic !== null ? semantic < 0 : false;
}

export function decideUpdate(installed: InstalledAppVersion, policy: PublicMobileReleasePolicy): UpdateDecision {
  const requiresMinimum = olderThan(installed, policy.minimumVersion, policy.minimumVersionCode);
  if (requiresMinimum || (policy.forceUpdate && olderThan(installed, policy.latestVersion, policy.latestVersionCode))) {
    return 'forced';
  }
  return olderThan(installed, policy.latestVersion, policy.latestVersionCode) ? 'optional' : 'none';
}

export function installedAppVersion(): InstalledAppVersion {
  const manifestVersion = Constants.expoConfig?.version || Constants.nativeAppVersion || '0.0.0';
  const rawCode = Constants.nativeBuildVersion || Constants.expoConfig?.android?.versionCode;
  const versionCode = typeof rawCode === 'number'
    ? rawCode
    : typeof rawCode === 'string' && /^\d+$/.test(rawCode) ? Number(rawCode) : null;
  return { version: manifestVersion, versionCode };
}

export const DEFAULT_PLAY_STORE_URL = 'market://details?id=com.cetin072.taejang.staff';
