import type { Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { disableCurrentPushDevice } from '@/src/notifications/push-registration';
import { getApiBaseUrl, loadPublicPlatformConfig, type PublicPlatformConfig } from '@/src/platform/config';
import { createPlatformSupabaseClient, type PlatformSupabaseClient } from '@/src/platform/supabase';

type PlatformPhase = 'loading' | 'ready' | 'error';

export type EmployeeSignupInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  hiredOn: string;
};

type PlatformContextValue = {
  phase: PlatformPhase;
  config: PublicPlatformConfig | null;
  client: PlatformSupabaseClient | null;
  session: Session | null;
  error: string;
  reload: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUpEmployee: (input: EmployeeSignupInput) => Promise<{ sessionStarted: boolean }>;
  requestPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const PlatformContext = createContext<PlatformContextValue | null>(null);

export function PlatformProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<PlatformPhase>('loading');
  const [config, setConfig] = useState<PublicPlatformConfig | null>(null);
  const [client, setClient] = useState<PlatformSupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let activeClient: PlatformSupabaseClient | null = null;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let appStateSubscription: { remove: () => void } | null = null;

    setPhase('loading');
    setError('');

    void (async () => {
      try {
        const nextConfig = await loadPublicPlatformConfig();
        const nextClient = createPlatformSupabaseClient(nextConfig);
        activeClient = nextClient;

        const { data, error: sessionError } = await nextClient.auth.getSession();
        if (sessionError) throw sessionError;
        if (!alive) return;

        setConfig(nextConfig);
        setClient(nextClient);
        setSession(data.session);
        setPhase('ready');

        const { data: authData } = nextClient.auth.onAuthStateChange((_event, nextSession) => {
          if (alive) setSession(nextSession);
        });
        authSubscription = authData.subscription;

        if (AppState.currentState === 'active') nextClient.auth.startAutoRefresh();
        appStateSubscription = AppState.addEventListener('change', (nextState) => {
          if (nextState === 'active') nextClient.auth.startAutoRefresh();
          else nextClient.auth.stopAutoRefresh();
        });
      } catch (nextError) {
        if (!alive) return;
        setError(nextError instanceof Error ? nextError.message : '태장 앱 초기화에 실패했습니다.');
        setPhase('error');
      }
    })();

    return () => {
      alive = false;
      authSubscription?.unsubscribe();
      appStateSubscription?.remove();
      activeClient?.auth.stopAutoRefresh();
    };
  }, [reloadKey]);

  const value = useMemo<PlatformContextValue>(
    () => ({
      phase,
      config,
      client,
      session,
      error,
      reload: () => setReloadKey(value => value + 1),
      signIn: async (email, password) => {
        if (!client) throw new Error('로그인 모듈이 아직 준비되지 않았습니다.');
        const { error: signInError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      },
      requestPasswordReset: async (email) => {
        if (!client) throw new Error('비밀번호 재설정 모듈이 아직 준비되지 않았습니다.');
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || !normalizedEmail.includes('@')) {
          throw new Error('가입할 때 사용한 이메일 주소를 확인해주세요.');
        }
        const { error: resetError } = await client.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${getApiBaseUrl()}/staff/reset-password.html`,
        });
        if (resetError) throw resetError;
      },
      signUpEmployee: async ({ name, email, phone, password, hiredOn }) => {
        if (!client) throw new Error('가입 모듈이 아직 준비되지 않았습니다.');
        const normalizedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedPhone = phone.trim();
        const normalizedHiredOn = hiredOn.trim();

        if (!normalizedName || !normalizedEmail || !normalizedPhone || !password || !normalizedHiredOn) {
          throw new Error('이름, 이메일, 전화번호, 비밀번호, 입사일을 모두 입력해주세요.');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedHiredOn)) {
          throw new Error('입사일은 2026-09-19처럼 입력해주세요.');
        }
        if (password.length < 8) {
          throw new Error('비밀번호는 8자 이상 입력해주세요.');
        }

        const { data, error: signUpError } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              display_name: normalizedName,
              phone: normalizedPhone,
              hired_on: normalizedHiredOn,
              signup_channel: 'native_employee',
            },
          },
        });
        if (signUpError) throw signUpError;
        if (!data.user) throw new Error('가입 요청을 만들지 못했습니다.');
        return { sessionStarted: Boolean(data.session) };
      },
      signOut: async () => {
        if (!client) return;
        try {
          await disableCurrentPushDevice(client);
        } catch {
          // Signing out must still work if the device-disable request is offline.
        }
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) throw signOutError;
      },
    }),
    [phase, config, client, session, error],
  );

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform() {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside PlatformProvider.');
  return value;
}