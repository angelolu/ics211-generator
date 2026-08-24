import React from 'react';
import { isSameDay, differenceInMinutes, format } from 'date-fns';
import {
  Calendar,
  ExternalLink,
  Info,
  MapPin,
  Shield,
  Users,
} from 'lucide-react';
import type { Activity, Attendee, Member } from '../api/d4h';
import { formatActivityLocation, getActivityStreetAddress, getMemberImageUrl, getSynchronousMemberImageUrl } from '../api/d4h';
import { ActivityMiniMap } from './ActivityMiniMap';
import { ActivityWeatherConditions } from './ActivityWeatherConditions';
import { cleanDescription } from './ActivityPopover';

interface ActivityInfoViewProps {
  activity: Activity | null;
  activityType?: string;
  activityName?: string;
  teamTitle?: string;
  attendees: Attendee[];
  members: Member[];
  medicalMap?: Record<number, string>;
  technicalMap?: Record<number, string>;
  isLocal?: boolean;
  onSwitchToRoster?: () => void;
  onSwitchToMap: () => void;
  onAttendanceChanged?: () => void;
}

const MemberTileAvatar: React.FC<{
  contextId: number;
  memberId?: number;
  name: string;
  isReadyToLoadPictures?: boolean;
}> = ({ contextId, memberId, name, isReadyToLoadPictures = true }) => {
  const [imgUrl, setImgUrl] = React.useState<string | null>(() => {
    return memberId ? getSynchronousMemberImageUrl(contextId, memberId) : null;
  });
  const [loaded, setLoaded] = React.useState<boolean>(() => {
    return memberId ? !!getSynchronousMemberImageUrl(contextId, memberId) : false;
  });

  React.useEffect(() => {
    let isCancelled = false;
    if (!isReadyToLoadPictures || !contextId || !memberId) return;

    // Defer network image request so main thread and attendee names resolve first
    const timer = setTimeout(() => {
      getMemberImageUrl(contextId, memberId).then((url) => {
        if (!isCancelled && url) {
          setImgUrl(url);
        }
      });
    }, 60);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [contextId, memberId, isReadyToLoadPictures]);

  const initials = React.useMemo(() => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [name]);

  return (
    <div
      style={{
        width: 64,
        height: 64,
        minWidth: 64,
        minHeight: 64,
        maxWidth: 64,
        maxHeight: 64,
        position: 'relative',
        background: 'var(--slate-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderTopLeftRadius: 9,
        borderBottomLeftRadius: 9,
        flexShrink: 0,
      }}
    >
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={name}
          onLoad={() => setLoaded(true)}
          style={{
            width: 64,
            height: 64,
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        />
      ) : null}

      {(!imgUrl || !loaded) && (
        !name || name === 'Responding Member' ? (
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--slate-4)',
              color: 'var(--slate-10)',
              fontWeight: 700,
              fontSize: '0.9375rem',
              letterSpacing: '-0.02em',
            }}
          >
            {initials}
          </div>
        )
      )}
    </div>
  );
};

export const ActivityInfoView: React.FC<ActivityInfoViewProps> = ({
  activity,
  attendees,
  members,
  onSwitchToMap,
}) => {
  const contextId = parseInt(localStorage.getItem('d4h_context_id') || '0', 10);
  const startDate = activity?.startsAt ? new Date(activity.startsAt) : new Date();
  const endDate = activity?.endsAt ? new Date(activity.endsAt) : startDate;
  const isMultiDay = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && !isSameDay(startDate, endDate);

  // Duration in hours
  let durationHours = 0;
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    const mins = Math.max(0, differenceInMinutes(endDate, startDate));
    durationHours = parseFloat((mins / 60).toFixed(1));
  }

  const streetAddress = getActivityStreetAddress(activity || undefined);
  const locationText = formatActivityLocation(activity || undefined);

  let lat: number | null = null;
  let lng: number | null = null;
  if (
    activity?.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [coordLng, coordLat] = activity.location.coordinates;
    if (coordLat !== 0 || coordLng !== 0) {
      lat = coordLat;
      lng = coordLng;
    }
  }

  const cleanedDesc = cleanDescription(activity?.description);

  const uniqueMemberIds = React.useMemo(() => {
    return new Set(attendees.map((a) => a.member?.id).filter(Boolean));
  }, [attendees]);

  const isMultiPeriod = React.useMemo(() => {
    const start = activity?.startsAt || (activity as any)?.startDate;
    const end = activity?.endsAt || (activity as any)?.endDate;
    if (start && end) {
      try {
        const d1 = new Date(start);
        const d2 = new Date(end);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && !isSameDay(d1, d2)) {
          return true;
        }
      } catch { }
    }

    const dates = new Set<string>();
    attendees.forEach((a) => {
      if (a.startsAt) {
        try {
          const d = new Date(a.startsAt);
          if (!isNaN(d.getTime())) dates.add(format(d, 'yyyy-MM-dd'));
        } catch { }
      }
    });
    return dates.size > 1;
  }, [activity, attendees]);

  const displayedAttendees = React.useMemo(() => {
    const memberMapById = new Map<number, {
      primaryAtt: Attendee;
      allAtts: Attendee[];
      earliestStartsAt?: string;
      latestEndsAt?: string;
      allOpDates: string[];
    }>();

    attendees.forEach((att) => {
      const memberId = att.member?.id;
      if (!memberId) return;

      let opDate: string | undefined;
      if (att.startsAt) {
        try {
          const d = new Date(att.startsAt);
          if (!isNaN(d.getTime())) {
            opDate = format(d, 'yyyy-MM-dd');
          }
        } catch { }
      }

      if (!memberMapById.has(memberId)) {
        memberMapById.set(memberId, {
          primaryAtt: att,
          allAtts: [att],
          earliestStartsAt: att.startsAt,
          latestEndsAt: att.endsAt,
          allOpDates: opDate ? [opDate] : [],
        });
      } else {
        const entry = memberMapById.get(memberId)!;
        entry.allAtts.push(att);
        if (opDate && !entry.allOpDates.includes(opDate)) {
          entry.allOpDates.push(opDate);
        }
        if (att.startsAt && (!entry.earliestStartsAt || new Date(att.startsAt) < new Date(entry.earliestStartsAt))) {
          entry.earliestStartsAt = att.startsAt;
        }
        if (att.endsAt && (!entry.latestEndsAt || new Date(att.endsAt) > new Date(entry.latestEndsAt))) {
          entry.latestEndsAt = att.endsAt;
        }
      }
    });

    return Array.from(memberMapById.values()).map((entry) => ({
      ...entry.primaryAtt,
      startsAt: entry.earliestStartsAt,
      endsAt: entry.latestEndsAt,
      _shiftsCount: entry.allAtts.length,
      _allOpDates: entry.allOpDates,
    }));
  }, [attendees]);

  // Map member lookup
  const memberMap = new Map<number, Member>();
  members.forEach((m) => memberMap.set(m.id, m));

  const isReadyToLoadPictures = attendees.length > 0 && members.length > 0;

  return (
    <div className="activity-info-view animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>


      {/* ── 2-Column Grid (Details + Map/Location) ──────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Left Card: Date & Conditions */}
        <div className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Card header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--slate-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={18} style={{ color: 'var(--navy-7)' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
                Date &amp; Conditions
              </h2>
            </div>
            {lat != null && lng != null && (
              <a
                href={`https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View full NOAA NWS forecast"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--slate-11)',
                  textDecoration: 'none',
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--slate-6)',
                  background: 'transparent',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--slate-3)';
                  e.currentTarget.style.color = 'var(--slate-12)';
                  e.currentTarget.style.borderColor = 'var(--slate-8)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--slate-11)';
                  e.currentTarget.style.borderColor = 'var(--slate-6)';
                }}
              >
                <ExternalLink size={11} />
                NOAA
              </a>
            )}
          </div>

          {/* NOAA Field Safety Weather & Duration Tiles */}
          <ActivityWeatherConditions
            lat={lat}
            lng={lng}
            startDate={startDate}
            endDate={endDate}
            durationHours={durationHours}
            isMultiDay={isMultiDay}
          />
        </div>

        {/* Right Card: Location & Mini Map */}
        <div className="card" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--slate-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <MapPin size={18} style={{ color: 'var(--navy-7)' }} />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
                Location
              </h2>
            </div>
            {lat != null && lng != null && (
              <button
                onClick={onSwitchToMap}
                className="btn btn-secondary btn-sm"
                style={{ fontSize: '0.75rem', padding: '3px 8px' }}
              >
                Expand Map
              </button>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--slate-12)' }}>
              {streetAddress ? (
                streetAddress
              ) : lat != null && lng != null ? (
                <span style={{ fontFamily: 'monospace' }}>
                  {lat.toFixed(5)}, {lng.toFixed(5)}
                </span>
              ) : (
                locationText || 'No specific location provided'
              )}
            </div>
            {!streetAddress && (activity?.address?.town || activity?.address?.street) && (
              <div style={{ fontSize: '0.75rem', color: 'var(--slate-9)', marginTop: 2 }}>
                {[activity?.address?.street, activity?.address?.town].filter(Boolean).join(', ')}
              </div>
            )}
          </div>

          {/* Mini-map embed */}
          <div style={{ marginTop: 2 }}>
            <ActivityMiniMap
              lat={lat}
              lng={lng}
              locationName={locationText}
              height={140}
            />
          </div>
        </div>
      </div>

      {/* ── Activity Description / Briefing ────────────────── */}
      {cleanedDesc && (
        <div className="card" style={{ padding: '22px 26px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--slate-3)', marginBottom: 14 }}>
            <Info size={18} style={{ color: 'var(--navy-7)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
              Activity Description
            </h2>
          </div>
          <div
            style={{
              fontSize: '0.9375rem',
              color: 'var(--slate-11)',
              lineHeight: 1.65,
              whiteSpace: 'pre-wrap',
            }}
          >
            {cleanedDesc}
          </div>
        </div>
      )}

      {/* ── Responding Personnel Summary ────────────────────── */}
      <div className="card" style={{ padding: '22px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '1px solid var(--slate-3)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Users size={18} style={{ color: 'var(--navy-7)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
              Responding Personnel
            </h2>
            <span
              style={{
                background: 'var(--navy-1)',
                border: '1px solid var(--navy-3)',
                color: 'var(--navy-9)',
                fontWeight: 700,
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: 12,
              }}
            >
              {uniqueMemberIds.size} {uniqueMemberIds.size === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>

        {displayedAttendees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--slate-9)', fontSize: '0.875rem' }}>
            No confirmed responding personnel found.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {displayedAttendees.map((att, idx) => {
              const memberId = att.member?.id;
              const m = memberId ? memberMap.get(memberId) : undefined;
              const name = att.member?.name || m?.name || 'Responding Member';
              const roleTitle = att.role?.title || m?.role?.title || m?.position;
              const shiftsCount = (att as any)._shiftsCount || 1;

              return (
                <div
                  key={memberId ?? idx}
                  style={{
                    background: 'var(--slate-1)',
                    border: '1px solid var(--slate-3)',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 64,
                    height: 64,
                    overflow: 'hidden',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <MemberTileAvatar
                    contextId={contextId}
                    memberId={memberId ?? 0}
                    name={name}
                    isReadyToLoadPictures={isReadyToLoadPictures}
                  />

                  <div
                    style={{
                      padding: '10px 14px',
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    {!name || name === 'Responding Member' ? (
                      <div className="skeleton" style={{ width: '60%', height: 16, borderRadius: 4, marginBottom: 2 }} />
                    ) : (
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {name}
                      </span>
                    )}

                    {/* Subtitle: Position / Role + Arrival */}
                    {(roleTitle || (isMultiPeriod && (att.startsAt || activity?.startsAt || (activity as any)?.startDate))) && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--slate-10)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        {roleTitle && <Shield size={12} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />}
                        <span
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {[
                            roleTitle,
                            isMultiPeriod && (att.startsAt || activity?.startsAt || (activity as any)?.startDate)
                              ? `Arrives ${format(new Date(att.startsAt || activity?.startsAt || (activity as any)?.startDate), 'MM/dd')}${(att as any)._allOpDates?.length > 1 ? ` for ${(att as any)._allOpDates.length}d` : shiftsCount > 1 ? ` for ${shiftsCount}d` : ''}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
