import { describe, expect, it } from 'vitest';
import { toUserMessage } from '../../src/shared/lib/userError';

describe('ユーザー向けエラー表示', () => {
  it('ネットワーク切断時は再試行と入力保持を案内する', () => {
    expect(toUserMessage(new Error('Failed to fetch'), { fallback: '保存できませんでした。', retryAction: '会計を確定', online: false }))
      .toBe('ネットワークに接続できません。通信が復旧したら「会計を確定」をもう一度実行してください。');
  });

  it('権限エラーを業務画面向けに変換する', () => {
    expect(toUserMessage({ code: '42501', message: 'permission denied for table sales' }, { fallback: '保存できませんでした。', online: true }))
      .toBe('この操作を実行する権限がありません。管理者にお問い合わせください。');
  });

  it('ログイン資格情報のエラーを日本語で表示する', () => {
    expect(toUserMessage({ message: 'Invalid login credentials' }, { fallback: 'ログインに失敗しました。', online: true }))
      .toBe('メールアドレスまたはパスワードが正しくありません。');
  });

  it('RPCの業務エラーはそのまま表示する', () => {
    expect(toUserMessage({ message: '選択した顧客が見つかりません。' }, { fallback: '保存できませんでした。', online: true }))
      .toBe('選択した顧客が見つかりません。');
  });

  it('内容のない例外では画面ごとのフォールバックを使う', () => {
    expect(toUserMessage({}, { fallback: '請求データを作成できませんでした。', online: true }))
      .toBe('請求データを作成できませんでした。');
  });
});
