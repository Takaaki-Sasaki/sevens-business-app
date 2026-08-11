export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error: unknown) => {
      console.warn('サービスワーカーを登録できませんでした。', error);
    });
  });
}
