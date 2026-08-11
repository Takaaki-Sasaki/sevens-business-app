import { useEffect, useState } from 'react';

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** オフライン中に保存操作を避けられるよう、全画面共通で接続状態を表示する。 */
export function NetworkStatusBanner() {
  const [online, setOnline] = useState(isOnline);

  useEffect(() => {
    const updateOnline = () => setOnline(true);
    const updateOffline = () => setOnline(false);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOffline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOffline);
    };
  }, []);

  if (online) return null;
  return (
    <aside className="network-status-banner" role="status" aria-live="polite">
      <strong>オフラインです</strong>
      <span>現在の入力内容は画面に保持されています。通信が復旧してから会計・保存を実行してください。</span>
    </aside>
  );
}
