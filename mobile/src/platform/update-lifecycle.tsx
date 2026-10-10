import * as Linking from 'expo-linking';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { isQaApp } from './app-variant';
import { secureSessionStorage } from './secure-storage';
import { decideUpdate, installedAppVersion, openPlayStore, updateTargetKey } from './release-policy';
import { loadPublicMobileReleasePolicy, type PublicMobileReleasePolicy } from './config';
import { usePlatform } from '@/src/providers/platform-provider';

const RELEASE_NOTES_KEY_PREFIX = 'taejang.mobile.release-notes.seen.';

export function UpdateLifecycle() {
  const { config } = usePlatform();
  const installed = useMemo(installedAppVersion, []);
  const [dismissedTarget, setDismissedTarget] = useState<string | null>(null);
  const [refreshedPolicy, setRefreshedPolicy] = useState<PublicMobileReleasePolicy | null | undefined>(undefined);
  const [storeOpening, setStoreOpening] = useState(false);
  const [storeError, setStoreError] = useState('');
  const [releaseNotesVisible, setReleaseNotesVisible] = useState(false);
  const policy = isQaApp ? null : refreshedPolicy === undefined ? config?.mobileRelease : refreshedPolicy;
  const update = policy ? decideUpdate(installed, policy) : 'none';
  const maintenanceVisible = Boolean(policy?.maintenanceMode);
  const target = policy ? updateTargetKey(policy) : null;
  const updateVisible = !maintenanceVisible && (update === 'forced' || (update === 'optional' && dismissedTarget !== target));

  useEffect(() => {
    if (isQaApp) return;
    // The provider already loads the startup policy. Resume refreshes only this
    // presentation state, without reinitializing Auth, attendance or notices.
    setRefreshedPolicy(undefined);
    let active = true;
    let checking = false;
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', state => {
      const resumed = state === 'active' && previousState !== 'active';
      previousState = state;
      if (!resumed || checking) return;
      checking = true;
      void loadPublicMobileReleasePolicy().then(next => {
        if (active) setRefreshedPolicy(next);
      }).catch(() => {
        // Do not trap staff behind a stale update prompt while offline.
        if (active) setRefreshedPolicy(null);
      }).finally(() => { checking = false; });
    });
    return () => { active = false; subscription.remove(); };
  }, [config?.mobileRelease]);

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
    if (isQaApp || storeOpening) return;
    setStoreOpening(true);
    setStoreError('');
    try { await openPlayStore(Linking.openURL); }
    catch { setStoreError('Play 스토어를 열지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러주세요.'); }
    finally { setStoreOpening(false); }
  }

  async function closeReleaseNotes() {
    await secureSessionStorage.setItem(`${RELEASE_NOTES_KEY_PREFIX}${installed.version}`, 'seen').catch(() => undefined);
    setReleaseNotesVisible(false);
  }

  if (!policy) return null;

  return (
    <>
      <Modal animationType="fade" transparent visible={maintenanceVisible} statusBarTranslucent onRequestClose={() => {}}>
        <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>잠시 점검 중입니다</Text>
          <Text style={styles.message}>{policy.maintenanceMessage || '더 안정적인 서비스를 위해 잠시 점검하고 있습니다. 잠시 후 다시 시도해주세요.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="고객센터 문의하기" onPress={() => void Linking.openURL('https://taejang.co.kr/#contact')} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>문의하기</Text></Pressable>
        </View></View>
      </Modal>
      <Modal animationType="fade" transparent visible={updateVisible} statusBarTranslucent onRequestClose={() => { if (update === 'optional') setDismissedTarget(target); }}>
        <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.updateCard}>
          <ScrollView contentContainerStyle={styles.updateContent}>
            <Text accessibilityRole="header" style={styles.title}>{policy.updateTitle || (update === 'forced' ? '태장 앱을 업데이트해주세요.' : '태장 앱의 새로운 버전이 나왔습니다.')}</Text>
            {policy.updateMessage || update === 'forced' ? <Text style={styles.message}>{policy.updateMessage || '최신 버전으로 업데이트한 후 이용할 수 있습니다.'}</Text> : null}
            {storeError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>{storeError}</Text> : null}
            {update === 'optional' ? <Pressable accessibilityRole="button" accessibilityLabel="나중에" onPress={() => setDismissedTarget(target)} style={styles.laterButton}><Text style={styles.laterButtonText}>나중에</Text></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="업데이트" accessibilityState={{ disabled: storeOpening, busy: storeOpening }} disabled={storeOpening} onPress={() => void openStore()} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{storeOpening ? 'Play 스토어 여는 중…' : '업데이트'}</Text></Pressable>
          </ScrollView>
        </View></View>
      </Modal>
      <Modal animationType="fade" transparent visible={!maintenanceVisible && !updateVisible && releaseNotesVisible} statusBarTranslucent onRequestClose={() => void closeReleaseNotes()}>
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
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(23, 63, 49, 0.55)' },
  updateCard: { maxHeight: '90%', width: '100%', maxWidth: 480, borderRadius: 22, backgroundColor: '#ffffff', overflow: 'hidden' },
  updateContent: { gap: 16, padding: 24 },
  card: { gap: 16, borderRadius: 22, padding: 24, backgroundColor: '#ffffff' },
  title: { color: '#173f31', fontSize: 24, fontWeight: '900', lineHeight: 32 },
  message: { color: '#344b40', fontSize: 16, fontWeight: '600', lineHeight: 24 },
  primaryButton: { minHeight: 56, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#35624d' },
  primaryButtonText: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  secondaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#aabbb0' },
  secondaryButtonText: { color: '#35624d', fontSize: 16, fontWeight: '900' },
  laterButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  laterButtonText: { color: '#52675d', fontSize: 16, fontWeight: '800' },
});
