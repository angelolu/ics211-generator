import React from 'react';
import { ShieldAlert, AlertTriangle, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MissingPermissionItem } from '@/api/d4h';

export interface D4HPermissionsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingPermissions: MissingPermissionItem[];
  teamTitle?: string;
  onDismiss?: () => void;
}

export const D4HPermissionsModal: React.FC<D4HPermissionsModalProps> = ({
  open,
  onOpenChange,
  missingPermissions,
  teamTitle,
  onDismiss,
}) => {
  if (missingPermissions.length === 0) return null;

  const handleDismiss = () => {
    onDismiss?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-5 sm:p-6" showCloseButton={true}>
        <DialogHeader className="gap-2.5 text-left">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <ShieldAlert className="size-4.5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                Limited D4H Permissions
              </DialogTitle>
              {teamTitle && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Context: <span className="font-semibold text-slate-700 dark:text-slate-300">{teamTitle}</span>
                </div>
              )}
            </div>
          </div>
          <DialogDescription className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-normal">
            Your D4H account is missing permissions that affect some features in this app. By proceeding, the following areas will be restricted:
          </DialogDescription>
        </DialogHeader>

        {/* List of missing permissions & succinct impact */}
        <div className="space-y-2 max-h-60 overflow-y-auto pr-1 py-1">
          {missingPermissions.map((item) => (
            <div
              key={item.id}
              className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-left space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-amber-500 shrink-0" />
                  {item.name}
                </span>
                <Badge
                  variant="outline"
                  className="text-[0.625rem] h-4 px-1.5 font-bold uppercase border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40"
                >
                  Missing
                </Badge>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {item.impact}
              </p>
            </div>
          ))}
        </div>

        <div className="text-[0.75rem] text-slate-400 dark:text-slate-500 leading-normal text-left">
          Tip: To enable full functionality, ask your D4H administrator to grant these permissions to your account.
        </div>

        <DialogFooter className="mt-2 sm:mt-4">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleDismiss}
            className="w-full sm:w-auto font-semibold text-xs h-8 px-4"
          >
            <Check className="size-3.5 mr-1" />
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
