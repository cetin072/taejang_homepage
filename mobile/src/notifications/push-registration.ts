import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { ensureNativeNotificationChannel, requestNativeNotificationPermission } from './native-notifications';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';

const INSTALLATION_ID_KEY = 'taejang.mobile.notification-installation.v1';
let installationPromise: Promise<string> | null = null;
const inFlight = new WeakMap<PlatformSupabaseClient, Promise<PushRegistrationResult>>();
const registered = new WeakMap<PlatformSupabaseClient, { fingerprint: string; at: number }>();

export type PushRegistrationResult =
  | { status: 'registered' }
  | { status: 'permission_required' }
  | { status: 'project_not_configured' }
  | { status: 'physical_device_required' }
  | { status: 'unsupported_platform' }
  | { status: 'native_not_configured' }
  | { status: 'token_unavailable' }
  | { status: 'session_required' }
  | { status: 'account_unavailable' }
  | { status: 'server_unavailable' };

async function installationId() {
  if (!installationPromise) {
    installationPromise = (async () => {
      const existing = await secureSessionStorage.getItem(INSTALLATION_ID_KEY);
      if (existing) return existing;
      const created = Crypto.randomUUID();
      await secureSessionStorage.setItem(INSTALLATION_ID_KEY, created);
      return created;
    })().catch(error => { installationPromise = null; throw error; });
  }
  return installationPromise;
}

function projectId() {
  if (Constants.expoConfig?.extra?.appVariant === 'qa') {
    return String(Constants.expoConfig?.extra?.eas?.projectId || '').trim();
  }
  return String(
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      || Constants.expoConfig?.extra?.eas?.projectId
      || Constants.easConfig?.projectId
      || '',
  ).trim();
}

async function registerDevice(
  client: PlatformSupabaseClient,
  options: { requestPermission: boolean },
): Promise<PushRegistrationResult> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { status: 'unsupported_platform' };
  if (!Device.isDevice) return { status: 'physical_device_required' };

  const configuredProjectId = projectId();
  if (!configuredProjectId) return { status: 'project_not_configured' };
  if (Platform.OS === 'android' && Constants.expoConfig?.extra?.pushConfigured !== true) {
    return { status: 'native_not_configured' };
  }
  const { data: auth } = await client.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return { status: 'session_required' };

  // Android 13 needs a channel before the permission/token request, even on auto registration.
  await ensureNativeNotificationChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && options.requestPermission) {
    permission = await requestNativeNotificationPermission();
  }
  if (!permission.granted) return { status: 'permission_required' };

  let token: string;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    token = (await Promise.race([
      Notifications.getExpoPushTokenAsync({ projectId: configuredProjectId }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('PUSH_TOKEN_TIMEOUT')), 15000);
      }),
    ])).data;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : '');
    return { status: /Firebase|google.services|FCM|projectId/i.test(message) ? 'native_not_configured' : 'token_unavailable' };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  // A sign-out/account switch while the OS permission dialog was open must not enroll a different user.
  const { data: currentAuth } = await client.auth.getSession();
  if (currentAuth.session?.user.id !== userId) return { status: 'session_required' };
  const installId = await installationId();
  const appVersion = Constants.nativeAppVersion || Constants.expoConfig?.version || null;
  const fingerprint = [userId, installId, token, appVersion].join('|');
  const last = registered.get(client);
  if (!options.requestPermission && last?.fingerprint === fingerprint && Date.now() - last.at < 15 * 60000) {
    return { status: 'registered' };
  }

  const { data, error } = await client.rpc('register_my_notification_device', {
    p_installation_id: installId,
    p_provider: 'expo',
    p_push_token: token,
    p_platform: Platform.OS,
    p_app_version: appVersion,
  });
  const result = data as { ok?: boolean; code?: string } | null;
  if (error || !result?.ok) {
    registered.delete(client);
    const code = String(error?.code || result?.code || '');
    if (code === '42501' || code === 'NOTIFICATION_DEVICE_FORBIDDEN') return { status: 'account_unavailable' };
    if (code === 'PGRST301' || code === '401') return { status: 'session_required' };
    return { status: 'server_unavailable' };
  }
  registered.set(client, { fingerprint, at: Date.now() });
  return { status: 'registered' };
}

export function registerCurrentPushDevice(client: PlatformSupabaseClient, options: { requestPermission: boolean }): Promise<PushRegistrationResult> {
  const current = inFlight.get(client);
  if (current) return options.requestPermission ? current.then(result =>
    result.status === 'permission_required' ? registerCurrentPushDevice(client, options) : result,
  ) : current;
  const request = registerDevice(client, options).finally(() => {
    if (inFlight.get(client) === request) inFlight.delete(client);
  });
  inFlight.set(client, request);
  return request;
}

export function pushRegistrationMessage(status: PushRegistrationResult['status']) {
  switch (status) {
    case 'registered': return '이 휴대폰의 알림 등록을 완료했습니다. 실제 알림 수신은 테스트 공지로 확인해주세요.';
    case 'project_not_configured': return '이 앱은 알림 연결이 아직 준비되지 않았습니다. 담당자에게 앱 업데이트를 문의해주세요.';
    case 'native_not_configured': return '이 앱의 휴대폰 알림 연결을 확인해야 합니다. 담당자에게 문의해주세요.';
    case 'permission_required': return '휴대폰 설정에서 태장 앱의 알림을 허용해주세요.';
    case 'physical_device_required': return '알림은 실제 휴대폰에서 설정할 수 있습니다.';
    case 'session_required': return '로그인 상태를 확인한 뒤 다시 시도해주세요.';
    case 'account_unavailable': return '현재 계정은 알림을 등록할 수 없습니다. 담당자에게 계정 상태를 확인해주세요.';
    case 'token_unavailable': return '휴대폰 알림 서비스에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.';
    case 'server_unavailable': return '알림 등록을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
    default: return '이 기기에서는 알림 설정을 지원하지 않습니다.';
  }
}

export async function disableCurrentPushDevice(client: PlatformSupabaseClient) {
  await inFlight.get(client)?.catch(() => undefined);
  registered.delete(client);
  const installId = await secureSessionStorage.getItem(INSTALLATION_ID_KEY);
  if (!installId) return;

  const { error } = await client.rpc('disable_my_notification_device', {
    p_installation_id: installId,
  });
  if (error) throw error;
}
