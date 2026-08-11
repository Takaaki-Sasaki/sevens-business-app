import { FormEvent, useState } from 'react';
import { requireSupabase } from '../../shared/lib/supabase';
import { toUserMessage } from '../../shared/lib/userError';

type LoginPageProps = {
  onSignedIn: () => Promise<void>;
};

export function LoginPage({ onSignedIn }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: signInError } = await requireSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      await onSignedIn();
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'ログインに失敗しました。', retryAction: 'ログイン' }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <img className="login-logo" src="/icons/sevens-logo.png" alt="SEVENS" />
        <p className="eyebrow">INTEGRATED OPERATIONS</p>
        <h1 id="login-title">社内業務アプリ</h1>
        <p className="login-description">顧客・レジ・売上・請求をひとつに。</p>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            メールアドレス
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            パスワード
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>

        <p className="login-help">アカウント発行は管理者へご依頼ください。</p>
      </section>
    </main>
  );
}
