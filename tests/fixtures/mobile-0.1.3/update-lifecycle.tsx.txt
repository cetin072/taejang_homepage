import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { secureSessionStorage } from './secure-storage';
import { DEFAULT_PLAY_STORE_URL, decideUpdate, installedAppVersion } from './release-policy';
import { usePlatform } from '@/src/providers/platform-provider';

const RELEASE_NOTES_KEY_PREFIX = 'taejang.mobile.release-notes.seen.';

export function UpdateLifecycle() {
  const { config } = usePlatform();
  const installed = useMemo(installedAppVersion, []);
  const [optionalDismissed, setOptionalDismissed] = useState(false);
  const [releaseNotesVisible, setReleaseNotesVisible] = useState(false);
  const policy = config?.mobileRelease;
  const update = policy ? decideUpdate(installed, policy) : 'none';
  const maintenanceVisible = Boolean(policy?.maintenanceMode);
  const storeUrl = policy?.storeUrl || DEFAULT_PLAY_STORE_URL;

  useEffect(() => {
    let active = true;
    if (!policy?.releaseNotes || policy.releaseNotesVersion !== installed.version) return;
    const key = `${RELEASE_NOTES_KEY_PREFIX}${installed.version}`;
    void secureSessionStorage.getItem(key).then(seen => {
      if (active && !seen) setReleaseNotesVisible(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [installed.version, policy?.releaseNotes, policy?.releaseNotesVersion]);

  async function openStore() {
    try { await Linking.openURL(storeUrl); } catch { /* retry action remains available */ }
  }

  async function closeReleaseNotes() {
    await secureSessionStorage.setItem(`${RELEASE_NOTES_KEY_PREFIX}${installed.version}`, 'seen').catch(() => undefined);
    setReleaseNotesVisible(false);
  }

  if (!policy) return null;

  return (
    <>
      <Modal animationType="fade" transparent visible={maintenanceVisible} statusBarTranslucent>
        <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>잠시 점검 중입니다</Text>
          <Text style={styles.message}>{policy.maintenanceMessage || '더 안정적인 서비스를 위해 잠시 점검하고 있습니다. 잠시 후 다시 시도해주세요.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="고객센터 문의하기" onPress={() => void Linking.openURL('https://taejang.co.kr/#contact')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>문의하기</Text></Pressable>
        </View></View>
      </Modal>
      <Modal animationType="fade" transparent visible={!maintenanceVisible && (update === 'forced' || (update === 'optional' && !optionalDismissed))} statusBarTranslucent>
        <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{policy.updateTitle || (update === 'forced' ? '업데이트가 필요합니다' : '새 버전이 있습니다')}</Text>
          <Text style={styles.message}>{policy.updateMessage || (update === 'forced' ? '계속 이용하려면 최신 버전으로 업데이트해주세요.' : '더 안정적인 태장 직원앱을 이용하려면 업데이트해주세요.')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="업데이트" onPress={() => void openStore()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>업데이트</Text></Pressable>
          {update === 'optional' ? <Pressable accessibilityRole="button" accessibilityLabel="나중에 업데이트" onPress={() => setOptionalDismissed(true)} style={styles.laterButton}><Text style={styles.laterButtonText}>나중에</Text></Pressable> : null}
        </View></View>
      </Modal>
      <Modal animationType="fade" transparent visible={!maintenanceVisible && update !== 'forced' && releaseNotesVisible} statusBarTranslucent>
        <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>변경사항</Text>
          <Text style={styles.message}>{policy.releaseNotes}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="변경사항 확인" onPress={() => void closeReleaseNotes()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>확인했습니다</Text></Pressable>
        </View></View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(23, 63, 49, 0.55)' },
  card: { gap: 16, borderRadius: 22, padding: 24, backgroundColor: '#ffffff' },
  title: { color: '#173f31', fontSize: 24, fontWeight: '900', lineHeight: 32 },
  message: { color: '#344b40', fontSize: 16, fontWeight: '600', lineHeight: 24 },
  primaryButton: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#35624d' },
  primaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  secondaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#aabbb0' },
  secondaryButtonText: { color: '#35624d', fontSize: 16, fontWeight: '900' },
  laterButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  laterButtonText: { color: '#52675d', fontSize: 16, fontWeight: '800' },
});
