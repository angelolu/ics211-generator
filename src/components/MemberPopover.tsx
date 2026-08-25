import React from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
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

  const badgeClass = isNonOperational
    ? 'badge badge-nonoperational'
    : isOperational
      ? 'badge badge-operational'
      : isWarningStatus
        ? 'badge badge-warning'
        : 'badge badge-info';

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
                <span className={badgeClass}>
                  {displayStatus}
                </span>
              ) : null}
            </div>

            {refTag && (
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
                {refTag}
              </span>
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
              gap: 8,
              marginTop: 2,
              paddingTop: 8,
              borderTop: '1px solid var(--slate-3)',
            }}
          >
            {phone && (
              <a
                href={`tel:${phone}`}
                className="btn btn-secondary btn-sm"
                style={{
                  flex: 1,
                  height: 30,
                  padding: '0 8px',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  gap: 5,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <Phone size={12} />
                <span>Call</span>
              </a>
            )}

            {email && (
              <a
                href={`mailto:${email}`}
                className="btn btn-secondary btn-sm"
                style={{
                  flex: 1,
                  height: 30,
                  padding: '0 8px',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  gap: 5,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxSizing: 'border-box',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <Mail size={12} />
                <span>Email</span>
              </a>
            )}

            {d4hUrl && (
              <a
                href={d4hUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                title="View member in D4H"
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  height: 30,
                  padding: '0 8px',
                  justifyContent: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  gap: 5,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  boxSizing: 'border-box',
                }}
              >
                <span>D4H</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          <HoverCard.Arrow style={{ fill: 'white' }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};
