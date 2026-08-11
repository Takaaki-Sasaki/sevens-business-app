import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean };

/** 描画時の予期しない例外を画面全体の停止にしないための最終防御。 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SEVENS application render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="loading-screen error-screen app-error-boundary">
          <p className="eyebrow">UNEXPECTED ERROR</p>
          <h1>画面を表示できませんでした</h1>
          <p>入力途中の内容を確認したうえで、画面を再読み込みしてください。繰り返し発生する場合は管理者に連絡してください。</p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>画面を再読み込み</button>
        </main>
      );
    }
    return this.props.children;
  }
}
