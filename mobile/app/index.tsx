import DateTimePicker from '@react-native-community/datetimepicker';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AttendanceCard } from '@/src/features/attendance/attendance-card';
import { OfficialChannelsFooter } from '@/src/features/common/official-channels-footer';
import { NoticeHomeAction } from '@/src/features/notices/notice-home-action';
import { getApiBaseUrl } from '@/src/platform/config';
import { usePlatform } from '@/src/providers/platform-provider';

type AccessRole = { code?: string; name?: string };
type AccessContext = {
  account_status?: string;
  display_name?: string | null;
  capabilities?: string[];
  actual_roles?: AccessRole[];
  effective_roles?: AccessRole[];
};

const WORK_PLATFORM_CAPABILITIES = new Set([
  'promotion.write',
  'promotion.review_lead',
  'promotion.review_operations',
  'attendance.admin_view',
  'employee.view_all',
  'employee.create',
  'employee.onboard',
  'account.view_management',
  'task.manage',
  'schedule.manage',
  'notice.manage',
  'homepage.draft',
  'homepage.review',
]);

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date();
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  return Number.isNaN(date.valueOf()) ? new Date() : date;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );