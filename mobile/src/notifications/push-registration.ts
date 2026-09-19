import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requestNativeNotificationPermission } from './native-notifications';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const INSTALLATION_ID_KEY = 'taejang.mobile.notification-installation.v1';

export type PushRegistrationResult =
  | { status: 'registered' }
  | { status: 'permission_required' }
  | { status: 'project_not_configured' }
  | { status: 'physical_device_required' }
  | { status: 'unsupported_platform' };

async function installationId() {
  const existing = await secureSessionStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await secureSessionStorage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

function projectId() {
  return String(
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      || Constants.expoConfig?.extra?.eas?.projectId
      || Constants.easConfig?.projectId
      || '',
  ).trim();
}

export async function registerCurrentPushDevice(
  client: PlatformSupabaseClient,
  options: { requestPermission: boolean },
): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { status: 'unsupported_platform' };
  if (!Device.isDevice) return { status: 'physical_device_required' };

  const configuredProjectId = projectId();
  if (!configuredProjectId) return { status: 'project_not_configured' };

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.requestPermission) {
    permission = await requestNativeNotificationPermission();
  }
  if (!permission.granted) return { status: 'permission_required' };

  const token = (await Notifications.getExpoPushTokenAsync({ projectId: configuredProjectId })).data;
  const installId = await installationId();
  const appVersion = Constants.expoConfig?.version || null;

  const { data, error } = await client.rpc('register_my_notification_device', {
    p_installation_id: installId,
    p_provider: 'expo',
    p_push_token: token,
    p_platform: Platform.OS,
    p_app_version: appVersion,
  });
  if (error) throw error;

  const result = data as { ok?: boolean; code?: string } | null;
  if (!result?.ok) throw new Error(result?.code || 'NOTIFICATION_DEVICE_REGISTER_FAILED');
  return { status: 'registered' };
}

export async function disableCurrentPushDevice(client: PlatformSupabaseClient) {
  const installId = await secureSessionStorage.getItem(INSTALLATION_ID_KEY);
  if (!installId) return;

  const { error } = await client.rpc('disable_my_notification_device', {
    p_installation_id: installId,
  });
  if (error) throw error;
}
