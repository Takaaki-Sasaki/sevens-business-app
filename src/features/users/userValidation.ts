import type { CreateManagedUserInput, UpdateManagedUserInput } from './types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinimumLength = 10;

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function validateNewManagedUser(input: CreateManagedUserInput): string | null {
  if (!emailPattern.test(input.email.trim())) return 'メールアドレスを正しく入力してください。';
  if (normalizeDisplayName(input.displayName).length > 100) return '表示名は100文字以内で入力してください。';
  if (input.password.length < passwordMinimumLength) return `初期パスワードは${passwordMinimumLength}文字以上で設定してください。`;
  if (!['admin', 'staff'].includes(input.role)) return '権限を選択してください。';
  return null;
}

export function validateManagedUserUpdate(input: UpdateManagedUserInput): string | null {
  if (!input.userId) return '対象ユーザーが見つかりません。';
  if (normalizeDisplayName(input.displayName).length > 100) return '表示名は100文字以内で入力してください。';
  if (!['admin', 'staff'].includes(input.role)) return '権限を選択してください。';
  return null;
}

export function validatePasswordReset(password: string): string | null {
  return password.length < passwordMinimumLength ? `新しいパスワードは${passwordMinimumLength}文字以上で設定してください。` : null;
}
