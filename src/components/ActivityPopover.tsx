import React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
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

  return (
    <HoverCard.Root openDelay={500} closeDelay={150}>
      <HoverCard.Trigger asChild>
        {children}
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          className="popover-content"
          side="top"
          align="center"
          sideOffset={8}
          style={{
            width: 320,
            maxWidth: '90vw',
            background: 'white',
            borderRadius: 12,
            border: '1px solid var(--slate-4)',
            boxShadow: '0 12px 32px -4px rgba(6,27,68,0.18), 0 4px 12px rgba(6,27,68,0.08)',
            padding: 16,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span
                className={`badge badge-${activity.type}`}
                style={{
                  height: 22,
                  padding: '0 8px',
                  borderRadius: 6,
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {TYPE_LABELS[activity.type]}
              </span>
              {activity.reference && (
                <span
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 6,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--slate-11)',
                    background: 'var(--slate-3)',
                    border: '1px solid var(--slate-4)',
                    letterSpacing: '0.05em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  {activity.reference}
                </span>
              )}
              {isAttending && (
                <span
                  style={{
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 6,
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--navy-9)',
                    background: 'var(--navy-1)',
                    border: '1px solid var(--navy-3)',
                    letterSpacing: '0.05em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    boxSizing: 'border-box',
                  }}
                >
                  <UserCheck size={12} strokeWidth={2.5} style={{ color: 'var(--navy-8)' }} />
                  {isPast ? 'Attended' : 'Attending'}
                </span>
              )}
            </div>
          </div>

          {/* Title */}
          <div>
            <h4 style={{
              fontSize: '0.9375rem',
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
            <button
              className="btn btn-primary btn-sm"
              style={{
                flex: 2,
                height: 32,
                padding: '0 12px',
                justifyContent: 'center',
                fontSize: '0.8125rem',
                fontWeight: 600,
                gap: 6,
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onOpenRoster(activity);
              }}
            >
              <span>Open Roster</span>
              <ArrowRight size={14} />
            </button>

            {d4hUrl && (
              <a
                href={d4hUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                title="Open D4H"
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  height: 32,
                  padding: '0 10px',
                  justifyContent: 'center',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  gap: 6,
                  boxSizing: 'border-box',
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>View D4H</span>
                <ExternalLink size={13} />
              </a>
            )}
          </div>

          <HoverCard.Arrow style={{ fill: 'white' }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};
