import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { Dashboard, type AppRoute } from '../features/dashboard/Dashboard';
import { LoginPage } from '../features/auth/LoginPage';
import type { Profile } from '../features/auth/types';
import { requireSupabase, supabase } from '../shared/lib/supabase';
import { toUserMessage } from '../shared/lib/userError';
import { NetworkStatusBanner } from '../shared/ui/NetworkStatusBanner';

type AppState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; profile: Profile }
  | { kind: 'profile-error'; message: string };

export function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' });
  const [route, setRoute] = useState<AppRoute>('home');
  const [customerDataVersion, setCustomerDataVersion] = useState(0);

  const loadProfile = useCallback(async (session: Session | null) => {
    if (!session) {
      setState({ kind: 'signed-out' });
      return;
    }

    try {
      const { data, error } = await requireSupabase()
        .from('profiles')
        .select('id, organization_id, email, display_name, role, active')
        .eq('id', session.user.id)
        .single<Profile>();

      if (error) throw error;
      if (!data.active) throw new Error('このアカウントは停止されています。管理者へお問い合わせください。');
      setState({ kind: 'ready', profile: data });
    } catch (caught) {
      setState({
        kind: 'profile-error',
        message: toUserMessage(caught, { fallback: '利用者情報を取得できませんでした。' }),
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setState({ kind: 'profile-error', message: 'Supabase接続情報がありません。.env.local を確認してください。' });
      return;
    }

    void supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadProfile(session);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadProfile]);

  async function signOut() {
    await requireSupabase().auth.signOut();
  }

  if (state.kind === 'loading') return <main className="loading-screen">SEVENSを起動しています…</main>;
  if (state.kind === 'signed-out') return <LoginPage onSignedIn={async () => {
    const { data } = await requireSupabase().auth.getSession();
    await loadProfile(data.session);
  }} />;
  if (state.kind === 'profile-error') {
    return (
      <main className="loading-screen error-screen">
        <h1>利用を開始できません</h1>
        <p>{state.message}</p>
        <button className="primary-button" type="button" onClick={() => void signOut()}>ログアウト</button>
      </main>
    );
  }
  return (
    <>
      <NetworkStatusBanner />
      <Dashboard
        profile={state.profile}
        onSignOut={signOut}
        route={route}
        onNavigate={setRoute}
        customerDataVersion={customerDataVersion}
        onCustomersChanged={() => setCustomerDataVersion((version) => version + 1)}
      />
    </>
  );
}
