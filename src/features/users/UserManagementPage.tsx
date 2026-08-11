import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { hasPermission } from '../auth/permissions';
import type { Profile } from '../auth/types';
import { toUserMessage } from '../../shared/lib/userError';
import { createManagedUser, listManagedUsers, resetManagedUserPassword, updateManagedUser } from './userApi';
import { validateManagedUserUpdate, validateNewManagedUser, validatePasswordReset } from './userValidation';
import type { CreateManagedUserInput, ManagedUser, UpdateManagedUserInput } from './types';

type Editor = { kind: 'create' } | { kind: 'edit'; userId: string };

const blankCreateInput: CreateManagedUserInput = {
  displayName: '', email: '', password: '', role: 'staff',
};

function toUpdateInput(user: ManagedUser): UpdateManagedUserInput {
  return {
    userId: user.id,
    displayName: user.display_name || '',
    role: user.role,
    active: user.active,
  };
}

function displayName(user: ManagedUser): string {
  return user.display_name || user.email.split('@')[0];
}

function roleLabel(role: ManagedUser['role']): string {
  return role === 'admin' ? '管理者' : 'スタッフ';
}

export function UserManagementPage({ profile }: { profile: Profile }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [editor, setEditor] = useState<Editor>({ kind: 'create' });
  const [search, setSearch] = useState('');
  const [createInput, setCreateInput] = useState<CreateManagedUserInput>(blankCreateInput);
  const [updateInput, setUpdateInput] = useState<UpdateManagedUserInput>();
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const canManage = hasPermission(profile.role, 'users.manage');
  const selectedUser = editor.kind === 'edit' ? users.find((user) => user.id === editor.userId) : undefined;
  const visibleUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ja');
    if (!term) return users;
    return users.filter((user) => [user.email, user.display_name || '', roleLabel(user.role)].join(' ').toLocaleLowerCase('ja').includes(term));
  }, [users, search]);

  useEffect(() => {
    if (!canManage) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listManagedUsers()
      .then((nextUsers) => {
        if (cancelled) return;
        setUsers(nextUsers);
        if (editor.kind === 'edit' && !nextUsers.some((user) => user.id === editor.userId)) setEditor({ kind: 'create' });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toUserMessage(caught, { fallback: 'ユーザー一覧を取得できませんでした。' }));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canManage, editor.kind, editor.kind === 'edit' ? editor.userId : '', refreshKey]);

  useEffect(() => {
    if (selectedUser) {
      setUpdateInput(toUpdateInput(selectedUser));
      setNewPassword('');
    }
  }, [selectedUser?.id, selectedUser?.updated_at]);

  function selectUser(user: ManagedUser) {
    setEditor({ kind: 'edit', userId: user.id });
    setError(null);
    setNotice(null);
  }

  function beginCreate() {
    setEditor({ kind: 'create' });
    setCreateInput(blankCreateInput);
    setNewPassword('');
    setError(null);
    setNotice(null);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateNewManagedUser(createInput);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createManagedUser(createInput);
      setCreateInput(blankCreateInput);
      setEditor({ kind: 'edit', userId: created.id });
      setNotice(`「${displayName(created)}」を登録しました。初期パスワードは安全な方法で本人へ共有してください。`);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'ユーザーを登録できませんでした。', retryAction: 'ユーザーを登録' }));
    } finally {
      setSaving(false);
    }
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser || !updateInput) return;
    const validationError = validateManagedUserUpdate(updateInput);
    if (validationError) { setError(validationError); return; }
    if (selectedUser.active && !updateInput.active && !window.confirm(`「${displayName(selectedUser)}」の利用を停止しますか？\n停止後も過去の売上・請求履歴は保持されます。`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateManagedUser(updateInput);
      setNotice(`「${displayName(updated)}」の設定を保存しました。`);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'ユーザー設定を保存できませんでした。', retryAction: '変更を保存' }));
    } finally {
      setSaving(false);
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;
    const validationError = validatePasswordReset(newPassword);
    if (validationError) { setError(validationError); return; }
    if (!window.confirm(`「${displayName(selectedUser)}」のパスワードを変更しますか？`)) return;
    setResettingPassword(true);
    setError(null);
    setNotice(null);
    try {
      await resetManagedUserPassword(selectedUser.id, newPassword);
      setNewPassword('');
      setNotice(`「${displayName(selectedUser)}」のパスワードを変更しました。新しいパスワードは安全な方法で本人へ共有してください。`);
    } catch (caught) {
      setError(toUserMessage(caught, { fallback: 'パスワードを変更できませんでした。', retryAction: 'パスワードを変更' }));
    } finally {
      setResettingPassword(false);
    }
  }

  if (!canManage) {
    return <section className="panel restricted-panel"><h1>アクセスできません</h1><p>ユーザー管理は管理者のみが操作できます。</p></section>;
  }

  return (
    <section className="page-view users-page" aria-labelledby="users-page-title">
      <header className="page-header">
        <div>
          <p className="eyebrow">USER MANAGEMENT</p>
          <h1 id="users-page-title">ユーザー管理</h1>
          <p className="page-description">ログイン利用者の作成、権限設定、利用停止、パスワード再設定を管理します。</p>
        </div>
      </header>
      {error && <p className="form-error page-error" role="alert">{error}</p>}
      {notice && <p className="document-notice" role="status">{notice}</p>}

      <div className="users-workspace">
        <section className="panel users-list-panel" aria-label="ユーザー一覧">
          <header className="panel-heading">
            <div><p className="eyebrow">USERS</p><h2>{loading ? '読み込み中…' : `${users.length}名`}</h2></div>
            <button type="button" className="secondary-button" onClick={beginCreate}>＋ 新規登録</button>
          </header>
          <label className="search-field"><span className="visually-hidden">ユーザーを検索</span><input type="search" value={search} placeholder="氏名・メールアドレスで検索" onChange={(event) => setSearch(event.target.value)} /></label>
          <div className="users-list">
            {!loading && visibleUsers.length === 0 && <p className="list-message">該当するユーザーはいません。</p>}
            {visibleUsers.map((user) => (
              <button type="button" key={user.id} onClick={() => selectUser(user)} className={selectedUser?.id === user.id ? 'user-row selected' : 'user-row'}>
                <span className="user-row-main"><strong>{displayName(user)}</strong><small>{user.email}</small></span>
                <span className="user-row-status"><em className={user.active ? 'active' : 'inactive'}>{user.active ? '有効' : '停止中'}</em><small>{roleLabel(user.role)}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel users-editor-panel">
          {editor.kind === 'create' ? (
            <form className="user-form" onSubmit={(event) => void submitCreate(event)}>
              <div className="panel-heading"><div><p className="eyebrow">NEW USER</p><h2>ユーザー登録</h2></div></div>
              <div className="form-grid">
                <label className="field"><span>表示名</span><input value={createInput.displayName} maxLength={100} placeholder="例：山田 太郎" onChange={(event) => setCreateInput((input) => ({ ...input, displayName: event.target.value }))} /></label>
                <label className="field"><span>権限 <b>必須</b></span><select value={createInput.role} onChange={(event) => setCreateInput((input) => ({ ...input, role: event.target.value as CreateManagedUserInput['role'] }))}><option value="staff">スタッフ</option><option value="admin">管理者</option></select></label>
                <label className="field full"><span>メールアドレス <b>必須</b></span><input type="email" value={createInput.email} autoComplete="off" placeholder="staff@example.com" onChange={(event) => setCreateInput((input) => ({ ...input, email: event.target.value }))} required /></label>
                <label className="field full"><span>初期パスワード <b>必須</b></span><input type="password" value={createInput.password} autoComplete="new-password" minLength={10} placeholder="10文字以上" onChange={(event) => setCreateInput((input) => ({ ...input, password: event.target.value }))} required /></label>
              </div>
              <div className="form-actions"><p>初期パスワードは保存・表示されません。ユーザー作成後、安全な方法で本人へ共有してください。</p><button type="submit" className="primary-button" disabled={saving}>{saving ? '登録中…' : 'ユーザーを登録'}</button></div>
            </form>
          ) : selectedUser && updateInput ? (
            <>
              <form className="user-form" onSubmit={(event) => void submitUpdate(event)}>
                <div className="panel-heading"><div><p className="eyebrow">USER SETTINGS</p><h2>{displayName(selectedUser)}</h2></div><span className={selectedUser.active ? 'status-chip' : 'status-chip muted'}>{selectedUser.active ? '有効' : '停止中'}</span></div>
                <div className="form-grid">
                  <label className="field full"><span>メールアドレス</span><input value={selectedUser.email} disabled /></label>
                  <label className="field"><span>表示名</span><input value={updateInput.displayName} maxLength={100} disabled={selectedUser.id === profile.id} onChange={(event) => setUpdateInput((input) => input ? { ...input, displayName: event.target.value } : input)} /></label>
                  <label className="field"><span>権限</span><select value={updateInput.role} disabled={selectedUser.id === profile.id} onChange={(event) => setUpdateInput((input) => input ? { ...input, role: event.target.value as UpdateManagedUserInput['role'] } : input)}><option value="staff">スタッフ</option><option value="admin">管理者</option></select></label>
                  <label className="toggle-field full"><input type="checkbox" checked={updateInput.active} disabled={selectedUser.id === profile.id} onChange={(event) => setUpdateInput((input) => input ? { ...input, active: event.target.checked } : input)} /><span><b>利用を許可する</b><small>停止すると次回操作時からデータへアクセスできません。履歴は削除されません。</small></span></label>
                </div>
                {selectedUser.id === profile.id ? <p className="user-self-note">ログイン中の自分自身は、この画面から変更できません。</p> : <div className="form-actions"><p>最後の有効な管理者は、スタッフ化・停止できません。</p><button type="submit" className="primary-button" disabled={saving}>{saving ? '保存中…' : '変更を保存'}</button></div>}
              </form>
              {selectedUser.id !== profile.id && selectedUser.active && <form className="user-password-form" onSubmit={(event) => void submitPasswordReset(event)}><div><p className="eyebrow">PASSWORD RESET</p><h3>パスワードを再設定</h3><p>新しいパスワードは画面に保存・再表示されません。</p></div><label className="field"><span>新しいパスワード</span><input type="password" autoComplete="new-password" minLength={10} value={newPassword} placeholder="10文字以上" onChange={(event) => setNewPassword(event.target.value)} required /></label><button type="submit" className="danger-button" disabled={resettingPassword}>{resettingPassword ? '変更中…' : 'パスワードを変更'}</button></form>}
            </>
          ) : <p className="list-message">左の一覧からユーザーを選択してください。</p>}
        </section>
      </div>
    </section>
  );
}
