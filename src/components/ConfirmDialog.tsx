import * as Dialog from '@radix-ui/react-dialog';
import * as Separator from '@radix-ui/react-separator';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onOpenChange, icon, title, description, confirmLabel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content no-print">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 4, marginBottom: 20 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'var(--red-3)', border: '1px solid var(--red-6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8,
            }}>
              {icon}
            </div>
            <Dialog.Title style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--slate-12)' }}>
              {title}
            </Dialog.Title>
            <Dialog.Description style={{ fontSize: '0.875rem', color: 'var(--slate-10)', lineHeight: 1.6, maxWidth: 360 }}>
              {description}
            </Dialog.Description>
          </div>

          <Separator.Root className="separator" style={{ marginBottom: 20 }} />

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Dialog.Close asChild>
              <button className="btn btn-secondary">Cancel</button>
            </Dialog.Close>
            <button
              className="btn btn-danger"
              onClick={() => { onConfirm(); onOpenChange(false); }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
