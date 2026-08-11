type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

type UserErrorOptions = {
  fallback: string;
  retryAction?: string;
  online?: boolean;
};

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  return { message: typeof error === 'string' ? error : undefined };
}

function currentOnlineStatus(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function connectionMessage(retryAction?: string): string {
  const retry = retryAction ? `通信が復旧したら「${retryAction}」をもう一度実行してください。` : '通信が復旧したら、もう一度実行してください。';
  return `ネットワークに接続できません。${retry}`;
}

/**
 * Supabaseやブラウザからの例外を、業務画面で判断できる日本語メッセージに整形する。
 * DBの業務エラー（RPCから返す日本語メッセージ）はそのまま表示する。
 */
export function toUserMessage(error: unknown, options: UserErrorOptions): string {
  const detail = asErrorLike(error);
  const message = typeof detail.message === 'string' ? detail.message.trim() : '';
  const code = typeof detail.code === 'string' ? detail.code : '';
  const isOnline = options.online ?? currentOnlineStatus();

  if (!isOnline || /failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return connectionMessage(options.retryAction);
  }
  if (code === '42501' || code === 'PGRST301' || /permission denied|not authorized|not authorised/i.test(message)) {
    return 'この操作を実行する権限がありません。管理者にお問い合わせください。';
  }
  if (code === 'PGRST303' || /jwt|token.*expired|session.*expired/i.test(message)) {
    return 'ログイン情報の有効期限が切れました。画面を再読み込みして、再度ログインしてください。';
  }
  if (/invalid login credentials|invalid.*password/i.test(message)) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (/email not confirmed/i.test(message)) {
    return 'メールアドレスの確認が完了していません。管理者にお問い合わせください。';
  }
  return message || options.fallback;
}
