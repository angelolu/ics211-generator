import { UserMinus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="no-print max-w-sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900">
            <UserMinus size={20} />
          </AlertDialogMedia>
          <AlertDialogTitle>Attendees removed on D4H</AlertDialogTitle>
          <AlertDialogDescription>
            {count} {plural} been removed from this activity. Remove the corresponding rows here?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              onKeepAsCustom();
              onOpenChange(false);
            }}
          >
            Keep as custom rows
          </AlertDialogCancel>
          <AlertDialogAction
            variant="default"
            onClick={() => {
              onRemoveRows();
              onOpenChange(false);
            }}
          >
            Remove rows
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
