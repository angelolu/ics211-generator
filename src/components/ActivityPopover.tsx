import React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format, isSameDay } from 'date-fns';
import {
  Calendar,
  ExternalLink,
  Users,
  UserCheck,
  ArrowRight,
} from 'lucide-react';
import type { Activity } from '../api/d4h';
import { formatActivityLocation, getD4HActivityUrl } from '../api/d4h';
import { ActivityMiniMap } from './ActivityMiniMap';

const TYPE_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  event: 'Event',
  incident: 'Incident',
};

/**
 * Strips HTML tags and decodes entities while preserving intentional line breaks.
 */
export function cleanDescription(htmlOrText?: string): string {
  if (!htmlOrText) return '';

  const withLineBreaks = htmlOrText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n\n')
    .replace(/<\/(tr|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '');

  const decoded = withLineBreaks
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&bull;/gi, '•');

  return decoded
    .replace(/\r\n|\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

interface ActivityPopoverProps {
  activity: Activity;
  isAttending?: boolean;
  children: React.ReactNode;
  onOpenRoster: (activity: Activity) => void;
}

export const ActivityPopover: React.FC<ActivityPopoverProps> = ({
  activity,
  isAttending = false,
  children,
  onOpenRoster,
}) => {
  const [open, setOpen] = React.useState(false);
  const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = React.useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  React.useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = setTimeout(() => {
      setOpen(true);
    }, 350);
  };

  const handleMouseLeave = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };

  const handleContentMouseEnter = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTimers();
    setOpen((prev) => !prev);
  };

  const startDate = new Date(activity.startsAt);
  const endDate = activity.endsAt ? new Date(activity.endsAt) : startDate;
  const isMultiDay = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && !isSameDay(startDate, endDate);
  const isPast = (activity.endsAt ? new Date(activity.endsAt) : startDate) < new Date();

  const locationText = formatActivityLocation(activity);

  let lat: number | null = null;
  let lng: number | null = null;

  if (
    activity.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [coordLng, coordLat] = activity.location.coordinates;
    if (coordLat !== 0 || coordLng !== 0) {
      lat = coordLat;
      lng = coordLng;
    }
  }

  const title = activity.referenceDescription || activity.description || `Unnamed ${activity.type}`;
  const d4hUrl = getD4HActivityUrl(activity.id, activity.type);
  const cleanedDesc = cleanDescription(activity.description);

  const triggerElement = React.isValidElement(children) ? (
    React.cloneElement(children as React.ReactElement<any>, {
      onClick: (e: React.MouseEvent) => {
        (children as React.ReactElement<any>).props?.onClick?.(e);
        handleTriggerClick(e);
      },
      onMouseEnter: (e: React.MouseEvent) => {
        (children as React.ReactElement<any>).props?.onMouseEnter?.(e);
        handleMouseEnter();
      },
      onMouseLeave: (e: React.MouseEvent) => {
        (children as React.ReactElement<any>).props?.onMouseLeave?.(e);
        handleMouseLeave();
      },
    })
  ) : (
    <div
      onClick={handleTriggerClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer' }}
    >
      {children}
    </div>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {triggerElement}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover-content"
          side="top"
          align="center"
          sideOffset={8}
          onMouseEnter={handleContentMouseEnter}
          onMouseLeave={handleMouseLeave}
          onInteractOutside={() => {
            clearTimers();
            setOpen(false);
          }}
          style={{
            width: 320,
            maxWidth: '90vw',
            background: 'white',
            borderRadius: 12,
            border: '1px solid var(--slate-4)',
            boxShadow: '0 12px 32px -4px rgba(6,27,68,0.18), 0 4px 12px rgba(6,27,68,0.08)',
            padding: 16,
            outline: 'none',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Badge
                variant="outline"
                className={`h-5.5 px-2 text-[0.6875rem] font-bold uppercase tracking-wider border ${
                  activity.type === 'incident'
                    ? 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
                    : activity.type === 'event'
                    ? 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800'
                    : 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800'
                }`}
              >
                {TYPE_LABELS[activity.type] || 'Activity'}
              </Badge>
              {isAttending && (
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[0.6875rem] font-bold border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1"
                >
                  <UserCheck size={11} strokeWidth={2.5} />
                  {isPast ? 'Attended' : 'Attending'}
                </Badge>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <h4 style={{
              fontSize: '0.875rem',
              fontWeight: 700,
              color: 'var(--slate-12)',
              margin: 0,
              lineHeight: 1.35,
            }}>
              {title}
            </h4>
          </div>

          {/* Date & Attendance */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.8125rem', color: 'var(--slate-11)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
              <span>
                {isMultiDay
                  ? `${format(startDate, 'MMM d, HH:mm')} – ${format(endDate, 'MMM d, HH:mm')}`
                  : `${format(startDate, 'MMM d, yyyy · HH:mm')} – ${format(endDate, 'HH:mm')}`}
              </span>
            </div>

            {activity.countAttendance !== undefined && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
                <span>
                  {activity.countAttendance} attending
                </span>
              </div>
            )}
          </div>

          {/* Description (Cleaned & Single Space) */}
          {cleanedDesc && cleanedDesc !== title && (
            <div style={{
              background: 'var(--slate-2)',
              border: '1px solid var(--slate-3)',
              borderRadius: 8,
              padding: '8px 10px',
              fontSize: '0.75rem',
              color: 'var(--slate-11)',
              lineHeight: 1.45,
              maxHeight: 75,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}>
              {cleanedDesc.length > 200 ? `${cleanedDesc.slice(0, 200).trim()}...` : cleanedDesc}
            </div>
          )}

          {/* Location Map / Info */}
          {(lat !== null || locationText) && (
            <ActivityMiniMap
              lat={lat}
              lng={lng}
              locationName={locationText}
              height={110}
            />
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, paddingTop: 8, borderTop: '1px solid var(--slate-3)' }}>
            <Button
              variant="default"
              size="sm"
              className="flex-2 h-8 text-xs font-semibold gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                clearTimers();
                setOpen(false);
                onOpenRoster(activity);
              }}
            >
              <span>Open Event</span>
              <ArrowRight size={14} />
            </Button>

            {d4hUrl && (
              <a
                href={d4hUrl}
                target="_blank"
                rel="noreferrer"
                title="Open D4H"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'flex-1 h-8 text-xs font-semibold gap-1.5 text-slate-700 dark:text-slate-200'
                )}
              >
                <span>D4H</span>
                <ExternalLink size={13} />
              </a>
            )}
          </div>

          <Popover.Arrow style={{ fill: 'white' }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

