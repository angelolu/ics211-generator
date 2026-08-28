import React from 'react';
import { AlertCircle, AlertTriangle, RefreshCw, KeyRound } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { D4HErrorDetails } from '@/api/d4h';
import { getD4HErrorDetails } from '@/api/d4h';

export interface D4HErrorAlertProps {
  error: Error | string | D4HErrorDetails | null | undefined;
  title?: string;
  className?: string;
  onRetry?: () => void;
  onReconnect?: () => void;
  isRetrying?: boolean;
}

export const D4HErrorAlert: React.FC<D4HErrorAlertProps> = ({
  error,
  title: customTitle,
  className,
  onRetry,
  onReconnect,
  isRetrying = false,
}) => {
  if (!error) return null;

  const details: D4HErrorDetails =
    typeof error === 'object' && error !== null && 'title' in error && 'message' in error
      ? (error as D4HErrorDetails)
      : getD4HErrorDetails(error);

  const displayTitle = customTitle || details.title;

  return (
    <Alert
      variant="destructive"
      className={cn(
        'text-left shadow-xs border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/40 text-red-950 dark:text-red-200',
        className
      )}
    >
      {details.isAuthError ? (
        <AlertCircle className="size-4 text-red-600 dark:text-red-400 mt-0.5" />
      ) : (
        <AlertTriangle className="size-4 text-red-600 dark:text-red-400 mt-0.5" />
      )}
      <AlertTitle className="font-semibold text-sm text-red-900 dark:text-red-200">
        {displayTitle}
      </AlertTitle>
      <AlertDescription className="space-y-2 mt-1 text-sm text-red-800 dark:text-red-300">
        <p className="leading-relaxed">{details.message}</p>

        {details.debugSnippet && (
          <div className="mt-2 text-xs font-mono text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-900/60 px-2.5 py-1.5 rounded-md border border-red-200/60 dark:border-red-900/40 break-all select-all leading-normal">
            <span className="font-semibold text-slate-400 dark:text-slate-500 mr-1 select-none">Debug:</span>
            {details.debugSnippet}
          </div>
        )}

        {(onRetry || onReconnect) && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {onRetry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
                className="h-7 px-2.5 text-xs font-semibold gap-1.5 bg-white dark:bg-slate-900 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 hover:bg-red-50 dark:hover:bg-red-950 shadow-2xs"
              >
                <RefreshCw size={12} className={cn(isRetrying && 'animate-spin')} />
                {isRetrying ? 'Retrying...' : 'Try Again'}
              </Button>
            )}

            {onReconnect && (details.isAuthError || !onRetry) && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={onReconnect}
                className="h-7 px-2.5 text-xs font-semibold gap-1.5 bg-red-700 hover:bg-red-800 text-white shadow-2xs"
              >
                <KeyRound size={12} />
                Reconnect D4H
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
};
