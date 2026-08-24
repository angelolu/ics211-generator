import React from 'react';
import { isSameDay, differenceInMinutes } from 'date-fns';
import {
  Calendar,
  ExternalLink,
  Info,
  MapPin,
  Shield,
  Users,
} from 'lucide-react';
import type { Activity, Attendee, Member } from '../api/d4h';
import { formatActivityLocation } from '../api/d4h';
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

export const ActivityInfoView: React.FC<ActivityInfoViewProps> = ({
  activity,
  attendees,
  members,
  onSwitchToMap,
}) => {
  const startDate = activity?.startsAt ? new Date(activity.startsAt) : new Date();
  const endDate = activity?.endsAt ? new Date(activity.endsAt) : startDate;
  const isMultiDay = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && !isSameDay(startDate, endDate);

  // Duration in hours
  let durationHours = 0;
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    const mins = Math.max(0, differenceInMinutes(endDate, startDate));
    durationHours = parseFloat((mins / 60).toFixed(1));
  }

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

  // Map member lookup
  const memberMap = new Map<number, Member>();
  members.forEach((m) => memberMap.set(m.id, m));

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
              {locationText || 'No specific location provided'}
            </div>
            {lat != null && lng != null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--slate-9)', marginTop: 2, fontFamily: 'monospace' }}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
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
              {attendees.length} {attendees.length === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>

        {attendees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--slate-9)', fontSize: '0.875rem' }}>
            No confirmed responding personnel found for this activity yet.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}
          >
            {attendees.map((att, idx) => {
              const memberObj = memberMap.get(att.member?.id);
              const name = att.member?.name || memberObj?.name || 'Unknown Member';
              const roleTitle = att.role?.title || memberObj?.role?.title || memberObj?.position;

              return (
                <div
                  key={att.id || idx}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--slate-1)',
                    border: '1px solid var(--slate-3)',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--slate-12)' }}>
                      {name}
                    </span>
                  </div>

                  {roleTitle && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Shield size={12} style={{ color: 'var(--slate-8)' }} />
                      <span>{roleTitle}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
