import { Badge, Button, Helper, ProgressBar } from 'akeneo-design-system';
import { MigrationState } from '../../hooks/useMigration';

interface MigrationProgressProps {
  state: MigrationState;
  onReset: () => void;
}

const MigrationProgress = ({ state, onReset }: MigrationProgressProps) => {
  const { status, totalProducts, processedProducts, successCount, errorCount, errors } = state;

  if (status === 'idle' || status === 'previewing' || status === 'ready') return null;

  const percent: number | 'indeterminate' =
    totalProducts > 0
      ? Math.round((processedProducts / totalProducts) * 100)
      : 'indeterminate';

  const progressLabel = totalProducts > 0
    ? `${processedProducts} / ${totalProducts}`
    : `${processedProducts} processed`;

  const progressLevel = status === 'complete' && errorCount === 0 ? 'primary' : 'warning';

  return (
    <div className="mt-6 space-y-4">
      <ProgressBar
        level={progressLevel}
        percent={status === 'complete' ? 100 : percent}
        title={status === 'migrating' ? 'Migration in progress...' : 'Migration complete'}
        progressLabel={progressLabel}
        size="large"
      />

      <div className="flex items-center gap-3">
        <Badge level="primary">{successCount} successful</Badge>
        {errorCount > 0 && (
          <Badge level="danger">{errorCount} failed</Badge>
        )}
      </div>

      {status === 'complete' && (
        <Helper level={errorCount === 0 ? 'success' : 'warning'}>
          {errorCount === 0
            ? `All ${successCount} products migrated successfully.`
            : `Migration complete — ${successCount} succeeded, ${errorCount} failed.`}
        </Helper>
      )}

      {errors.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono space-y-1">
          {errors.map(e => (
            <div key={e.productUuid} className="text-red-700">
              <span className="font-semibold">{e.productUuid}:</span> {e.error}
            </div>
          ))}
        </div>
      )}

      {status === 'complete' && (
        <Button level="secondary" onClick={onReset}>
          Start New Migration
        </Button>
      )}
    </div>
  );
};

export default MigrationProgress;
