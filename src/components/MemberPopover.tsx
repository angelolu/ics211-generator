import React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  HeartPulse,
  Mail,
  MapPin,
  Phone,
  Wrench,
} from 'lucide-react';
import type { Activity, Attendee, Member } from '../api/d4h';
import { extractMemberRegion, getD4HMemberUrl } from '../api/d4h';
import { extractEmail, formatMemberStatus } from '../utils/memberMaps';

interface MemberPopoverProps {
  member?: Member;
  attendee?: Attendee;
  contextId?: number;
  activity?: Activity | null;
  medicalQual?: string;
  technicalQual?: string;
  isLocal?: boolean;
  children: React.ReactNode;
}

export const MemberPopover: React.FC<MemberPopoverProps> = ({
  member,
  attendee,
  contextId,
  medicalQual,
  technicalQual,
  isLocal = false,
  children,
}) => {
  const memberId = member?.id || attendee?.member?.id;

  const effectiveMember = React.useMemo(() => {
    if (member && (member.status || member.customStatus || member.name || member.customFieldValues)) {
      return member;
    }
    if (contextId && memberId) {
      try {
        const raw = localStorage.getItem(`d4h_members_cache_${contextId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed)
            ? parsed
            : (parsed.data && Array.isArray(parsed.data) ? parsed.data : Object.values(parsed));
          const found = list.map((item: any) => item?.data || item).find((m: any) => m && m.id === memberId);
          if (found) return found;
        }
      } catch { }
    }
    return member || (attendee?.member as any) || null;
  }, [member, contextId, memberId, attendee?.member]);

  const rawStatus =
    effectiveMember?.customStatus?.title ||
    effectiveMember?.customStatus?.name ||
    (typeof effectiveMember?.status === 'string' && effectiveMember.status !== 'ATTENDING'
      ? formatMemberStatus(effectiveMember.status)
      : '') ||
    '';

  const isNonOperational =
    rawStatus.toLowerCase().includes('non-operat') ||
    rawStatus.toLowerCase().includes('non operat') ||
    rawStatus.toLowerCase().includes('nonoperat') ||
    effectiveMember?.status === 'NON_OPERATIONAL';

  const isOperational =
    !isNonOperational &&
    (rawStatus.toLowerCase().includes('operat') ||
      effectiveMember?.status === 'OPERATIONAL' ||
      rawStatus.toLowerCase().includes('active') ||
      effectiveMember?.status === 'ACTIVE' ||
      !rawStatus);

  const isWarningStatus =
    !isNonOperational &&
    !isOperational &&
    (rawStatus.toLowerCase().includes('probation') ||
      rawStatus.toLowerCase().includes('reserve') ||
      rawStatus.toLowerCase().includes('leave') ||
      effectiveMember?.status === 'PROBATIONARY' ||
      effectiveMember?.status === 'RESERVE');

  const displayStatus = isNonOperational
    ? 'Non-Operational'
    : isOperational
      ? 'Operational'
      : rawStatus
        ? formatMemberStatus(rawStatus)
        : 'Operational';

  const refTag = effectiveMember?.ref || effectiveMember?.idTag || member?.ref || (memberId ? `#${memberId}` : '');

  const phone =
    effectiveMember?.mobile?.phone ||
    effectiveMember?.home?.phone ||
    effectiveMember?.work?.phone ||
    effectiveMember?.pager?.phone ||
    member?.mobile?.phone ||
    '';

  const email = effectiveMember?.email
    ? extractEmail(effectiveMember.email)
    : member?.email
      ? extractEmail(member.email)
      : '';

  const region = extractMemberRegion(effectiveMember || member);

  const d4hUrl = !isLocal && memberId ? getD4HMemberUrl(memberId) : null;

  return (
    <HoverCard.Root openDelay={400} closeDelay={150}>
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
            width: 270,
            maxWidth: '90vw',
            background: 'white',
            borderRadius: 12,
            border: '1px solid var(--slate-4)',
            boxShadow: '0 12px 32px -4px rgba(6,27,68,0.18), 0 4px 12px rgba(6,27,68,0.08)',
            padding: 14,
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {/* Header: Status on Left, Badge Number / Ref on Right */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div>
              {displayStatus ? (
                isNonOperational ? (
                  <Badge variant="destructive" className="h-5.5 px-2 text-[0.6875rem] font-bold">
                    {displayStatus}
                  </Badge>
                ) : isOperational ? (
                  <Badge
                    variant="outline"
                    className="h-5.5 px-2 text-[0.6875rem] font-bold border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                  >
                    {displayStatus}
                  </Badge>
                ) : isWarningStatus ? (
                  <Badge
                    variant="secondary"
                    className="h-5.5 px-2 text-[0.6875rem] font-bold border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                  >
                    {displayStatus}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="h-5.5 px-2 text-[0.6875rem] font-bold">
                    {displayStatus}
                  </Badge>
                )
              ) : null}
            </div>

            {refTag && (
              <Badge
                variant="outline"
                className="h-5.5 px-2 text-[0.6875rem] font-bold font-mono tracking-wider text-slate-700 bg-slate-100/70 border-slate-300 dark:text-slate-300 dark:bg-slate-800"
              >
                {refTag}
              </Badge>
            )}
          </div>

          {/* Contact & Location Details (Rendered directly on base popover) */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: '0.8125rem',
              color: 'var(--slate-11)',
              padding: '2px 0',
            }}
          >
            {phone && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <Phone size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
                <a
                  href={`tel:${phone}`}
                  style={{
                    color: 'var(--navy-10)',
                    textDecoration: 'none',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                  onClick={(e) => e.stopPropagation()}
                >
                  {phone}
                </a>
              </div>
            )}

            {email && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <Mail size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
                <a
                  href={`mailto:${email}`}
                  style={{
                    color: 'var(--navy-10)',
                    textDecoration: 'none',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                  onClick={(e) => e.stopPropagation()}
                >
                  {email}
                </a>
              </div>
            )}

            {region && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <MapPin size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
                <span
                  style={{
                    color: 'var(--navy-10)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {region}
                </span>
              </div>
            )}

            {!phone && !email && !region && (
              <div style={{ color: 'var(--slate-9)', fontStyle: 'italic', fontSize: '0.75rem' }}>
                No contact information available
              </div>
            )}
          </div>

          {/* Qualifications */}
          {(medicalQual || technicalQual) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  color: 'var(--slate-9)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Qualifications
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: '0.8125rem' }}>
                {medicalQual && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
                    <HeartPulse size={13} style={{ color: 'var(--slate-8)', flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: 'var(--navy-10)', fontWeight: 600, lineHeight: 1.35 }}>
                      {medicalQual}
                    </span>
                  </div>
                )}
                {technicalQual && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
                    <Wrench size={13} style={{ color: 'var(--slate-8)', flexShrink: 0, marginTop: 2 }} />
                    <span style={{ color: 'var(--navy-10)', fontWeight: 500, lineHeight: 1.35 }}>
                      {technicalQual}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 6,
              marginTop: 2,
              paddingTop: 8,
              borderTop: '1px solid var(--slate-3)',
            }}
          >
            {phone && (
              <a
                href={`tel:${phone}`}
                onClick={(e) => e.stopPropagation()}
                title={`Call ${phone}`}
                aria-label={`Call ${phone}`}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'size-8 p-0 flex items-center justify-center text-slate-700 dark:text-slate-200'
                )}
              >
                <Phone size={14} />
              </a>
            )}

            {email && (
              <a
                href={`mailto:${email}`}
                onClick={(e) => e.stopPropagation()}
                title={`Email ${email}`}
                aria-label={`Email ${email}`}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'size-8 p-0 flex items-center justify-center text-slate-700 dark:text-slate-200'
                )}
              >
                <Mail size={14} />
              </a>
            )}

            {d4hUrl && (
              <a
                href={d4hUrl}
                target="_blank"
                rel="noreferrer"
                title="View in D4H"
                aria-label="View member in D4H"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'size-8 p-0 flex items-center justify-center text-slate-700 dark:text-slate-200'
                )}
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>

          <HoverCard.Arrow style={{ fill: 'white' }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};
