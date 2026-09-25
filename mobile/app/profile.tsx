import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyContactChangeRequests, loadMyEmployeeProfile, submitMyContactChangeRequest, type ContactChangeRequest, type EmployeeProfile } from '@/src/features/profile/profile-api';
import { usePlatform } from '@/src/providers/platform-provider';

function requestLabel(status: ContactChangeRequest['status']) {
  return ({ pending: '승인 대기', approved: '승인됨', changes_requested: '보완 필요', rejected: '반려됨', cancelled: '취소됨' } as const)[status];
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session } = usePlatform();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [requests, setRequests] = useState<ContactChangeRequest[]>([]);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    setError('');
    try {
      const [nextProfile, nextRequests] = await Promise.all([
        loadMyEmployeeProfile(client),
        loadMyContactChangeRequests(client),
      ]);
      setProfile(nextProfile);
      setPhone(nextProfile.phone || '');
      setRequests(nextRequests);
    } catch {
      setError('내 정보를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => { void load(); }, [load]);

  async function submit() {
    if (!client || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitMyContactChangeRequest(client, phone);
      if (!result?.ok && result?.code === 'CONTACT_PHONE_UNCHANGED') {
        Alert.alert('연락처 변경', '현재 등록된 연락처와 같습니다.');
      } else if (!result?.ok && result?.code === 'CONTACT_CHANGE_ALREADY_PENDING') {
        Alert.alert('연락처 변경', '이미 처리 대기 중인 변경 요청이 있습니다.');
      } else if (!result?.ok) {
        Alert.alert('연락처 변경', '요청을 제출하지 못했습니다. 입력한 번호를 확인해주세요.');
      } else {
        Alert.alert('변경 요청 접수', '관리자 확인 후 등록된 연락처가 바뀝니다.');
        await load();
      }
    } catch {
      Alert.alert('연락처 변경', '요청을 제출하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" accessibilityLabel="설정으로 돌아가기" onPress={() => router.replace('/settings')} style={styles.back}>
          <Text style={styles.backText}>← 설정</Text>
        </Pressable>
        <Text style={styles.title}>내 정보</Text>
        <Text style={styles.help}>업무에 필요한 기본 정보만 확인합니다.</Text>
        {loading ? <View style={styles.loading}><ActivityIndicator /><Text style={styles.help}>내 정보를 확인하고 있습니다.</Text></View> : null}
        {!loading && error ? <Pressable accessibilityRole="button" accessibilityLabel="내 정보 다시 불러오기" onPress={() => void load()} style={styles.card}><Text style={styles.error}>{error}</Text><Text style={styles.retry}>다시 시도</Text></Pressable> : null}
        {!loading && profile ? <>
          <View style={styles.card}>
            {[["이름", profile.full_name], ["부서", profile.department_name], ["직책", profile.position_name], ["입사일", profile.hired_on]].map(([label, value]) => <View key={label} style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value || '-'}</Text></View>)}
          </View>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>연락처</Text>
            <Text style={styles.help}>변경 요청은 관리자 확인 후 반영됩니다.</Text>
            <TextInput accessibilityLabel="변경할 연락처" keyboardType="phone-pad" value={phone} onChangeText={setPhone} style={styles.input} maxLength={30} placeholder="010-1234-5678" />
            <Pressable accessibilityRole="button" accessibilityLabel="연락처 변경 요청 제출" disabled={submitting} onPress={() => void submit()} style={[styles.primary, submitting ? styles.disabled : null]}><Text style={styles.primaryText}>{submitting ? '요청을 보내고 있습니다…' : '연락처 변경 요청'}</Text></Pressable>
          </View>
          {requests.length ? <View style={styles.card}><Text style={styles.sectionTitle}>변경 요청 상태</Text>{requests.map(request => <View key={request.id} style={styles.request}><Text style={styles.requestTitle}>{requestLabel(request.status)} · {request.proposed_phone}</Text><Text style={styles.help}>{new Date(request.requested_at).toLocaleDateString('ko-KR')}</Text>{request.decision_comment ? <Text style={styles.help}>관리자 의견: {request.decision_comment}</Text> : null}</View>)}</View> : null}
        </> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f6f4ed' }, scroll: { gap: 14, padding: 22, paddingBottom: 40 }, back: { alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' }, backText: { color: '#35624d', fontSize: 16, fontWeight: '800' }, title: { color: '#173f31', fontSize: 32, fontWeight: '900' }, help: { color: '#60746a', fontSize: 14, lineHeight: 20 }, loading: { alignItems: 'center', gap: 10, paddingVertical: 30 }, card: { gap: 12, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#d7ded8', backgroundColor: '#fff' }, row: { minHeight: 34, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, label: { color: '#60746a', fontSize: 15, fontWeight: '700' }, value: { flex: 1, color: '#173f31', fontSize: 16, fontWeight: '900', textAlign: 'right' }, sectionTitle: { color: '#173f31', fontSize: 18, fontWeight: '900' }, input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: '#aebbb2', paddingHorizontal: 14, color: '#173f31', fontSize: 17, backgroundColor: '#fff' }, primary: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#35624d' }, primaryText: { color: '#fff', fontSize: 16, fontWeight: '900' }, request: { gap: 4, borderTopWidth: 1, borderColor: '#e3e8e3', paddingTop: 12 }, requestTitle: { color: '#173f31', fontSize: 15, fontWeight: '800' }, error: { color: '#87362f', fontWeight: '800' }, retry: { color: '#35624d', fontWeight: '900' }, disabled: { opacity: 0.55 },
});
