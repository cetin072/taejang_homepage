import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  QA_DAY_LABELS,
  type QaDayScenario,
  type QaHomePersona,
  type QaInspectionMode,
} from './qa-preview-state';

type QaPreviewControlsProps = {
  open: boolean;
  onToggle: () => void;
  persona: QaHomePersona;
  onPersonaChange: (value: QaHomePersona) => void;
  inspection: QaInspectionMode;
  onInspectionChange: (value: QaInspectionMode) => void;
  scenario: QaDayScenario;
  onScenarioChange: (value: QaDayScenario) => void;
};

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.choice, selected ? styles.selectedChoice : null]}
    >
      <Text style={[styles.choiceText, selected ? styles.selectedText : null]}>{label}</Text>
    </Pressable>
  );
}

export function QaPreviewControls({
  open,
  onToggle,
  persona,
  onPersonaChange,
  inspection,
  onInspectionChange,
  scenario,
  onScenarioChange,
}: QaPreviewControlsProps) {
  const personaLabel = persona === 'operations_lead' ? '운영팀장' : '일반 직원';
  const inspectionLabel = inspection === 'preview' ? QA_DAY_LABELS[scenario] : 'GPS·서버 검수';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? '검수 설정 닫기' : '검수 설정 열기'}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.header}
      >
        <Text style={styles.headerText}>QA · {personaLabel} 시점 · {inspectionLabel}</Text>
        <Text style={styles.headerToggle}>{open ? '접기 ▲' : '변경 ▼'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.content}>
          <Text style={styles.label}>검수할 직원 화면</Text>
          <View style={styles.choices}>
            <Choice label="운영팀장 시점" selected={persona === 'operations_lead'} onPress={() => onPersonaChange('operations_lead')} />
            <Choice label="일반 직원 시점" selected={persona === 'employee'} onPress={() => onPersonaChange('employee')} />
          </View>
          <Text style={styles.label}>출퇴근 검사 방식</Text>
          <View style={styles.choices}>
            <Choice label="직원 화면 체험" selected={inspection === 'preview'} onPress={() => onInspectionChange('preview')} />
            <Choice label="GPS·서버 검수" selected={inspection === 'server'} onPress={() => onInspectionChange('server')} />
          </View>
          {inspection === 'preview' ? (
            <>
              <Text style={styles.label}>체험할 근무일 상태</Text>
              <View style={styles.choices}>
                <Choice label={QA_DAY_LABELS.today} selected={scenario === 'today'} onPress={() => onScenarioChange('today')} />
                <Choice label={QA_DAY_LABELS.workday} selected={scenario === 'workday'} onPress={() => onScenarioChange('workday')} />
                <Choice label={QA_DAY_LABELS.hangul} selected={scenario === 'hangul'} onPress={() => onScenarioChange('hangul')} />
              </View>
            </>
          ) : null}
          <Text style={styles.explanation}>
            {inspection === 'preview'
              ? '직원 화면 체험은 실제 근태를 저장하지 않습니다. 오늘의 휴일 여부만 서버 달력을 읽고, 예시 날짜는 모의 상태입니다.'
              : '실제 GPS와 서버의 검수용 경로를 확인합니다. 검수 권한이 없는 계정에서는 안전하게 차단됩니다.'}
          </Text>
          <Text style={styles.explanation}>시점 전환은 화면 구성만 변경합니다. 로그인 계정의 권한·공지 접근 범위는 그대로입니다.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, borderWidth: 1, borderColor: '#dbcc94', backgroundColor: '#fffaf0', overflow: 'hidden' },
  header: { minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, paddingVertical: 8 },
  headerText: { flex: 1, color: '#6b5314', fontSize: 13, fontWeight: '800', lineHeight: 19 },
  headerToggle: { color: '#6b5314', fontSize: 12, fontWeight: '800' },
  content: { gap: 9, padding: 13, paddingTop: 3, borderTopWidth: 1, borderTopColor: '#e7dcb4' },
  label: { color: '#5d4a13', fontSize: 13, fontWeight: '900' },
  choices: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  choice: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#c9bea0' },
  selectedChoice: { backgroundColor: '#173f31', borderColor: '#173f31' },
  choiceText: { color: '#4e554b', fontSize: 13, fontWeight: '800' },
  selectedText: { color: '#ffffff' },
  explanation: { color: '#76694d', fontSize: 12, lineHeight: 18, fontWeight: '600' },
});
