import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { noticeDeepLinkPath } from '@/src/features/notices/notice-api';
import { registerCurrentPushDevice } from './push-registration';
import { usePlatform } from '@/src/providers/platform-provider';

function noticeIdFromResponse(response: Notifications.NotificationResponse | null) {
  const data = response?.notification.request.content.data as {
    target?: unknown;
    noticeId?: unknown;
  } | undefined;
  if (data?.target !== 'notice' || typeof data.noticeId !== 'string' || !data.noticeId) return null;
  return data.noticeId;
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
      const noticeId = noticeIdFromResponse(response);
      if (!noticeId) return;
      router.push(noticeDeepLinkPath(noticeId));
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
