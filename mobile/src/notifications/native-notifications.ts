import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const NOTICE_CHANNEL_ID = 'taejang-important-notices';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNativeNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(NOTICE_CHANNEL_ID, {
      name: '태장 중요공지',
      description: '태장 중요공지와 꼭 확인해야 할 회사 알림',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 180, 120, 180],
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return current;
  return Notifications.requestPermissionsAsync();
}

export const nativeNotificationFoundation = {
  channelId: NOTICE_CHANNEL_ID,
  remotePushTokenRegistrationImplemented: false,
} as const;
