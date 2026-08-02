import { Component, type ErrorInfo, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('IMDS Super Admin frontend crashed.', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private goHome = () => {
    window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="error-boundary-screen" role="alert">
        <section className="error-boundary-card">
          <div className="error-boundary-mark" aria-hidden="true">!</div>
          <span className="eyebrow">Frontend recovery</span>
          <h1>Интерфейс временно недоступен</h1>
          <p>Произошла ошибка отображения. Данные не изменены. Перезагрузите приложение или вернитесь на главную страницу.</p>
          {import.meta.env.DEV && <pre>{error.message}</pre>}
          <div className="error-boundary-actions">
            <button className="primary-button" type="button" onClick={this.reload}>Перезагрузить</button>
            <button className="secondary-button compact" type="button" onClick={this.goHome}>На главную</button>
          </div>
        </section>
      </main>
    );
  }
}
