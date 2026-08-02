import { Network } from 'lucide-react';

export function IntegrationCenterPage() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Integration Control Plane</span>
          <h1>Интеграции</h1>
          <p>Провайдеры, подключения, webhooks, API clients и фоновые синхронизации.</p>
        </div>
      </div>
      <div className="empty-state">
        <div><Network size={34} /></div>
        <h2>Integration Registry подключён на уровне базы и API</h2>
        <p>Полный операционный интерфейс будет расширен после завершения основных архитектурных контуров.</p>
      </div>
    </>
  );
}
