import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadPromotionFeedback,
  loadPromotionWorkspace,
  promotionStatusLabel,
  savePromotionDraft,
  submitPromotionDraft,
  type DisclosureAnswer,
  type PromotionContentType,
  type PromotionDraftInput,
  type PromotionFeedback,
  type PromotionItem,
  type PromotionWorkspace,
} from '@/src/features/promotion/promotion-api';
import { usePlatform } from '@/src/providers/platform-provider';

const EMPTY_DRAFT: PromotionDraftInput = {
  contentId: null,
  slug: null,
  contentType: 'homepage_article',
  title: '',
  summary: '',
  body: '',
  externalUrl: '',
  sourceReferenceUrl: '',
  byline: null,
  bylineKind: 'company',
  relatedOrganization: null,
  heroImageUrl: null,
  publicMedia: [],
  peoplePhoto: 'unsure',
  numberOrAmount: 'unsure',
  requestedPublishDate: '',
};

function draftFromItem(item: PromotionItem): PromotionDraftInput {
  return {
    contentId: item.content_id,
    slug: item.slug,
    contentType: item.content_type,
    title: item.title || '',
    summary: item.summary || '',
    body: item.public_body || '',
    externalUrl: item.external_url || '',
    sourceReferenceUrl: item.source_reference_url || '',
    byline: item.byline,
    bylineKind: item.byline_kind || 'company',
    relatedOrganization: item.related_organization,
    heroImageUrl: item.hero_image_url,
    publicMedia: Array.isArray(item.public_media) ? item.public_media : [],
    peoplePhoto: item.people_photo || 'unsure',
    numberOrAmount: item.number_or_amount || 'unsure',
    requestedPublishDate: item.requested_publish_date || '',
  };
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.choiceRow}>
        {options.map(option => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            style={[styles.choice, value === option.value ? styles.choiceActive : null]}
            onPress={() => onChange(option.value)}
          >
            <Text style={value === option.value ? styles.choiceTextActive : styles.choiceText}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function PromotionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, session } = usePlatform();
  const [workspace, setWorkspace] = useState<PromotionWorkspace | null>(null);
  const [draft, setDraft] = useState<PromotionDraftInput>(EMPTY_DRAFT);
  const [feedback, setFeedback] = useState<PromotionFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);

  const refresh = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    try {
      const next = await loadPromotionWorkspace(client);
      if (next.role !== 'promotion_staff') {
        throw new Error('홍보직원 모바일 작성 권한이 없습니다.');
      }
      setWorkspace(next);
    } catch (error) {
      setWorkspace(null);
      setMessage(error instanceof Error ? error.message : '홍보 업무를 불러오지 못했습니다.');
      setMessageError(true);
    } finally {
      setLoading(false);
    }
  }, [client, session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function show(text: string, error = false) {
    setMessage(text);
    setMessageError(error);
  }

  async function openEditableItem(item: PromotionItem) {
    setDraft(draftFromItem(item));
    setFeedback(null);

    if (item.lifecycle !== 'needs_revision' || !client) {
      show('저장 중인 초안을 열었습니다.');
      return;
    }

    try {
      const nextFeedback = await loadPromotionFeedback(client, item.content_id);
      setFeedback(nextFeedback);
      show(nextFeedback?.comment
        ? '운영팀장 보완 의견을 확인했습니다. 수정 후 다시 상신해주세요.'
        : '보완 요청된 글을 열었습니다. 수정 후 다시 상신해주세요.');
    } catch {
      show('보완 요청된 글을 열었지만 상세 보완 의견은 불러오지 못했습니다.', true);
    }
  }

  async function save(submitAfterSave: boolean) {
    if (!client || busy) return;
    setBusy(true);
    show('');
    try {
      const saved = await savePromotionDraft(client, draft);
      if (submitAfterSave) {
        await submitPromotionDraft(client, saved.contentId);
        show('운영팀장에게 상신했습니다.');
        setDraft(EMPTY_DRAFT);
        setFeedback(null);
      } else {
        show('초안을 저장했습니다.');
        setDraft(current => ({
          ...current,
          contentId: saved.contentId,
          slug: saved.slug,
        }));
      }
      await refresh();
    } catch (error) {
      show(error instanceof Error ? error.message : '홍보글을 저장하지 못했습니다.', true);
    } finally {
      setBusy(false);
    }
  }

  const editable = workspace?.my_items.filter(
    item => item.lifecycle === 'draft' || item.lifecycle === 'needs_revision',
  ) || [];
  const submitted = workspace?.my_items.filter(
    item => item.lifecycle !== 'draft' && item.lifecycle !== 'needs_revision',
  ) || [];

  const referenceValue = draft.contentType === 'external_content'
    ? draft.externalUrl
    : draft.sourceReferenceUrl;

  return (
    <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Button title="← 직원 홈으로" onPress={() => router.back()} />

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>홍보직원 업무</Text>
          <Text style={styles.title}>작성·상신·보완</Text>
          <Text style={styles.help}>
            글을 작성해 운영팀장에게 상신하세요. 최종 승인단계는 서버 규칙과 관리자 검토가 결정합니다.
          </Text>
        </View>

        {loading ? <ActivityIndicator /> : null}

        {editable.length ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>이어 작성할 글</Text>
            {editable.map(item => (
              <Pressable
                key={item.content_id}
                style={styles.item}
                accessibilityRole="button"
                accessibilityLabel={`${item.title} ${promotionStatusLabel(item.lifecycle)} 열기`}
                onPress={() => void openEditableItem(item)}
              >
                <Text style={styles.itemStatus}>{promotionStatusLabel(item.lifecycle)}</Text>
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.lifecycle === 'needs_revision' ? (
                  <Text style={styles.revision}>운영팀장 보완 의견을 확인하고 다시 상신하세요.</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {submitted.length ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>상신 현황</Text>
            {submitted.map(item => (
              <View key={item.content_id} style={styles.statusRow}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemStatus}>{promotionStatusLabel(item.lifecycle)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {feedback ? (
          <View style={styles.feedbackCard}>
            <Text style={styles.feedbackTitle}>
              {feedback.decision === 'rejected' ? '반려 의견' : '운영팀장 보완 의견'}
            </Text>
            <Text style={styles.feedbackText}>{feedback.comment || '구체적인 의견이 등록되지 않았습니다.'}</Text>
          </View>
        ) : null}

        {workspace ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{draft.contentId ? '콘텐츠 수정·보완' : '새 홍보글 작성'}</Text>
            {draft.contentId ? (
              <Button
                title="새 글로 초기화"
                onPress={() => {
                  setDraft(EMPTY_DRAFT);
                  setFeedback(null);
                  show('');
                }}
              />
            ) : null}

            <Choice<PromotionContentType>
              label="글 종류"
              value={draft.contentType}
              options={[
                { value: 'homepage_article', label: '홈페이지 글' },
                { value: 'external_content', label: '외부 콘텐츠' },
                { value: 'press_release', label: '보도자료' },
              ]}
              onChange={contentType => setDraft(current => ({
                ...current,
                contentType,
                externalUrl: contentType === 'external_content'
                  ? (current.externalUrl || current.sourceReferenceUrl)
                  : current.externalUrl,
              }))}
            />

            <TextInput
              accessibilityLabel="홍보글 제목"
              placeholder="제목"
              maxLength={160}
              style={styles.input}
              value={draft.title}
              onChangeText={title => setDraft(current => ({ ...current, title }))}
            />
            <TextInput
              accessibilityLabel="홍보글 요약"
              placeholder="짧은 요약 (선택)"
              maxLength={500}
              multiline
              style={[styles.input, styles.multilineSmall]}
              value={draft.summary}
              onChangeText={summary => setDraft(current => ({ ...current, summary }))}
            />
            <TextInput
              accessibilityLabel="홍보글 본문"
              placeholder="공개할 내용을 작성해주세요."
              maxLength={30000}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.multiline]}
              value={draft.body}
              onChangeText={body => setDraft(current => ({ ...current, body }))}
            />
            <TextInput
              accessibilityLabel={draft.contentType === 'external_content' ? '외부 링크' : '참고 링크'}
              placeholder={draft.contentType === 'external_content'
                ? '외부 기사·콘텐츠 https://...'
                : '참고 링크 https://... (선택)'}
              autoCapitalize="none"
              keyboardType="url"
              style={styles.input}
              value={referenceValue}
              onChangeText={value => setDraft(current => (
                current.contentType === 'external_content'
                  ? { ...current, externalUrl: value, sourceReferenceUrl: value }
                  : { ...current, sourceReferenceUrl: value }
              ))}
            />

            <Choice<DisclosureAnswer>
              label="사람이 나온 사진이 있나요?"
              value={draft.peoplePhoto}
              options={[
                { value: 'unsure', label: '잘 모르겠음' },
                { value: 'yes', label: '있음' },
                { value: 'no', label: '없음' },
              ]}
              onChange={peoplePhoto => setDraft(current => ({ ...current, peoplePhoto }))}
            />

            <Choice<DisclosureAnswer>
              label="숫자·금액이 포함되나요?"
              value={draft.numberOrAmount}
              options={[
                { value: 'unsure', label: '잘 모르겠음' },
                { value: 'yes', label: '있음' },
                { value: 'no', label: '없음' },
              ]}
              onChange={numberOrAmount => setDraft(current => ({ ...current, numberOrAmount }))}
            />

            <TextInput
              accessibilityLabel="게시 희망일"
              placeholder="게시 희망일 YYYY-MM-DD (선택)"
              autoCapitalize="none"
              style={styles.input}
              value={draft.requestedPublishDate}
              onChangeText={requestedPublishDate => setDraft(current => ({ ...current, requestedPublishDate }))}
            />

            {draft.publicMedia.length || draft.heroImageUrl ? (
              <Text style={styles.preservedMedia}>
                기존 첨부 사진은 모바일에서 삭제하지 않고 그대로 보존합니다.
              </Text>
            ) : null}

            <View style={styles.actionRow}>
              <Button title={busy ? '저장 중…' : '임시저장'} disabled={busy} onPress={() => void save(false)} />
              <Button title={busy ? '처리 중…' : '저장 후 운영팀장 상신'} disabled={busy} onPress={() => void save(true)} />
            </View>
          </View>
        ) : null}

        {message ? (
          <Text style={messageError ? styles.error : styles.message}>{message}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f7f4' },
  scroll: { gap: 16, padding: 20 },
  intro: { gap: 6 },
  eyebrow: { color: '#654b8d', fontSize: 13, fontWeight: '800' },
  title: { color: '#382650', fontSize: 28, fontWeight: '800' },
  help: { color: '#60746a', fontSize: 14, lineHeight: 21 },
  card: {
    gap: 13,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d4e0d7',
  },
  sectionTitle: { color: '#173f31', fontSize: 20, fontWeight: '800' },
  item: { gap: 5, padding: 13, borderRadius: 12, backgroundColor: '#f6f2fb' },
  itemStatus: { color: '#654b8d', fontSize: 12, fontWeight: '800' },
  itemTitle: { color: '#382650', fontSize: 16, fontWeight: '800' },
  revision: { color: '#9a5c09', fontSize: 13, fontWeight: '700' },
  statusRow: { gap: 4, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e3e8e4' },
  feedbackCard: {
    gap: 7,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#fff5df',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e1c58d',
  },
  feedbackTitle: { color: '#80510e', fontSize: 14, fontWeight: '900' },
  feedbackText: { color: '#68481d', fontSize: 15, lineHeight: 22 },
  field: { gap: 7 },
  label: { color: '#344b40', fontSize: 14, fontWeight: '800' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#f5f6f5',
    borderWidth: 1,
    borderColor: '#cbd7cf',
  },
  choiceActive: { backgroundColor: '#e8ddf5', borderColor: '#8165a7' },
  choiceText: { color: '#4e6157', fontSize: 13, fontWeight: '700' },
  choiceTextActive: { color: '#493064', fontSize: 13, fontWeight: '800' },
  input: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#9eb2a5',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    color: '#173f31',
    fontSize: 15,
  },
  multilineSmall: { minHeight: 84 },
  multiline: { minHeight: 190 },
  preservedMedia: {
    padding: 10,
    borderRadius: 9,
    backgroundColor: '#eef4ef',
    color: '#4b6255',
    fontSize: 13,
    lineHeight: 19,
  },
  actionRow: { gap: 10 },
  message: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#e6f0e9',
    color: '#214b35',
    fontSize: 14,
  },
  error: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fdeaea',
    color: '#8b2f2f',
    fontSize: 14,
  },
});
