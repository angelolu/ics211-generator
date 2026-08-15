import * as Dialog from '@radix-ui/react-dialog';
import * as Separator from '@radix-ui/react-separator';
import { UserMinus } from 'lucide-react';

interface RemovedAttendeesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onKeepAsCustom: () => void;
  onRemoveRows: () => void;
}

export function RemovedAttendeesModal({
  open,
  onOpenChange,
  count,
  onKeepAsCustom,
  onRemoveRows,
}: RemovedAttendeesModalProps) {
  const plural = count === 1 ? 'attendee has' : 'attendees have';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content no-print">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, marginBottom: 20 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'var(--amber-3)', border: '1px solid var(--amber-6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
            }}>
              <UserMinus size={24} color="var(--amber-10)" />
            </div>
            <Dialog.Title style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--slate-12)' }}>
              Attendees removed on D4H
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: '0.875rem', color: 'var(--slate-10)', lineHeight: 1.6, maxWidth: 360 }}>
              {count} {plural} been removed from this activity. Remove the corresponding rows here?
            </Dialog.Description>
          </div>

          <Separator.Root className="separator" style={{ marginBottom: 20 }} />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onKeepAsCustom();
                onOpenChange(false);
              }}
            >
              Keep as custom rows
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onRemoveRows();
                onOpenChange(false);
              }}
            >
              Remove rows
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
