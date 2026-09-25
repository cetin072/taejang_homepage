import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PushNotificationBridge } from '@/src/notifications/push-notification-bridge';
import { PlatformProvider } from '@/src/providers/platform-provider';
import { UpdateLifecycle } from '@/src/platform/update-lifecycle';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PlatformProvider>
        <PushNotificationBridge />
        <UpdateLifecycle />
        <Stack screenOptions={{ headerShown: false }} />
      </PlatformProvider>
    </SafeAreaProvider>
  );
}
