import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { noticeDeepLinkPath } from '@/src/features/notices/notice-api';
import { scheduleDeepLinkPath } from '@/src/features/schedules/schedule-api';
import { registerCurrentPushDevice } from './push-registration';
import { usePlatform } from '@/src/providers/platform-provider';

function deepLinkPathFromResponse(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as {
    target?: unknown;
    noticeId?: unknown;
    scheduleId?: unknown;
  } | undefined;
  if (data?.target === 'notice' && typeof data.noticeId === 'string' && data.noticeId) return noticeDeepLinkPath(data.noticeId);
  if (data?.target === 'schedule' && typeof data.scheduleId === 'string' && data.scheduleId) return scheduleDeepLinkPath(data.scheduleId);
  return null;
}

export function PushNotificationBridge() {
  const router = useRouter();
  const { client, session } = usePlatform();

  useEffect(() => {
    if (!client || !session) return;
    void registerCurrentPushDevice(client, { requestPermission: false }).catch(() => undefined);
  }, [client, session?.access_token]);

  useEffect(() => {
    const open = async (response: Notifications.NotificationResponse | null) => {
      const path = deepLinkPathFromResponse(response);
      if (!path) return;
      router.push(path);
      await Notifications.clearLastNotificationResponseAsync();
    };

    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      void open(response);
    });
    return () => subscription.remove();
  }, [router]);

  return null;
}
