import React, { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  Thermometer,
  Wind,
  CloudRain,
  Sun,
  Cloud,
  CloudLightning,
  CloudSnow,
  ShieldAlert,
  CalendarCheck,
  CalendarX,
} from 'lucide-react';
import { format } from 'date-fns';
import { fetchNOAAWeather } from '../api/weather';
import type { WeatherSafetySummary } from '../api/weather';

/**
 * Formats two ISO date strings into a human-readable forecast validity range.
 * Same-day: "Sat Aug 23, 15:00 – 21:00"
 * Multi-day: "Sat Aug 23, 15:00 – Sun Aug 24, 06:00"
 */
function formatValidityPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const fmtTime = (d: Date) => {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  };
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${fmtDate(start)}, ${fmtTime(start)} – ${fmtTime(end)}`;
  }
  return `${fmtDate(start)}, ${fmtTime(start)} – ${fmtDate(end)}, ${fmtTime(end)}`;
}

// ── Shared tile style constants ──────────────────────────────────
const TILE_STYLE: React.CSSProperties = {
  background: 'var(--slate-1)',
  border: '1px solid var(--slate-3)',
  borderRadius: 12,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 6,
  minHeight: 84,
  boxSizing: 'border-box',
  flex: '1 1 130px',
  minWidth: 0,
  transition: 'all 0.15s ease',
};
const TILE_LABEL_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--slate-9)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};
const TILE_LABEL: React.CSSProperties = {};

interface ActivityWeatherConditionsProps {
  lat: number | null;
  lng: number | null;
  startDate: Date;
  endDate: Date;
  durationHours: number;
  isMultiDay: boolean;
}

export const ActivityWeatherConditions: React.FC<ActivityWeatherConditionsProps> = ({
  lat,
  lng,
  startDate,
  endDate,
  durationHours,
  isMultiDay,
}) => {
  const [weather, setWeather] = useState<WeatherSafetySummary | null>(null);

  const loadWeather = async () => {
    if (lat == null || lng == null) {
      setWeather(null);
      return;
    }

    try {
      const data = await fetchNOAAWeather(lat, lng, startDate, endDate);
      // data is null when the incident window is outside NOAA's forecast horizon
      // or no incident date is set — silently show nothing in that case
      setWeather(data);
    } catch (e) {
      console.warn('Weather load error:', e);
    }
  };

  useEffect(() => {
    loadWeather();
  }, [lat, lng, startDate.getTime(), endDate.getTime()]);

  // Determine weather icon based on forecast condition
  const getWeatherIcon = (condition: string = '') => {
    const c = condition.toLowerCase();
    if (c.includes('thunder') || c.includes('lightning')) {
      return <CloudLightning size={14} style={{ color: '#d97706' }} />;
    }
    if (c.includes('snow') || c.includes('flurries') || c.includes('ice')) {
      return <CloudSnow size={14} style={{ color: '#0284c7' }} />;
    }
    if (c.includes('rain') || c.includes('shower') || c.includes('drizzle')) {
      return <CloudRain size={14} style={{ color: '#0284c7' }} />;
    }
    if (c.includes('cloud') || c.includes('overcast') || c.includes('fog')) {
      return <Cloud size={14} style={{ color: '#64748b' }} />;
    }
    return <Sun size={14} style={{ color: '#ea580c' }} />;
  };

  // Helper to check if a status badge/message is shown
  const hasStatusBadge = (status?: string) => {
    return !!status && status !== 'normal' && status !== 'calm' && status !== 'dry' && status !== 'low';
  };

  const getWeatherTileStyle = (status?: string, delayMs = 0): React.CSSProperties => {
    const hasBadge = hasStatusBadge(status);
    return {
      ...TILE_STYLE,
      flex: hasBadge ? '1.25 1 160px' : '1 1 130px',
      animation: `weatherEntrance 0.35s cubic-bezier(0.16, 1, 0.3, 1) ${delayMs}ms both`,
    };
  };

  // Status badge styling helper
  const getStatusBadge = (_type: 'temp' | 'wind' | 'precip', status?: string) => {
    if (!hasStatusBadge(status)) {
      return null;
    }

    const isDanger = status === 'freeze-danger' || status === 'heat-danger' || status === 'high-hazard' || status === 'heavy' || status === 'dense-fog';

    let label = 'Caution';
    if (status === 'freeze-danger') label = 'Freeze Hazard';
    if (status === 'heat-danger') label = 'Extreme Heat';
    if (status === 'high-hazard') label = 'High Wind Hazard';
    if (status === 'dense-fog') label = 'Dense Fog';
    if (status === 'heavy') label = 'Rain';

    return (
      <Badge
        variant={isDanger ? 'destructive' : 'secondary'}
        className={`h-4.5 text-[0.625rem] px-1.5 font-bold uppercase ${isDanger
            ? ''
            : 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
          }`}
      >
        {label}
      </Badge>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ── Active NWS Alerts Banner ────────────────────────── */}
      {weather?.alerts && weather.alerts.length > 0 && (
        <Alert
          variant="destructive"
          className="border-rose-200 bg-rose-50/90 text-rose-950 dark:bg-rose-950/40 dark:border-rose-900 shadow-xs"
        >
          <ShieldAlert className="size-4 text-rose-600 dark:text-rose-400" />
          <div className="flex flex-col gap-1 w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTitle className="text-xs font-bold text-rose-900 dark:text-rose-200 m-0">
                NWS Active Alert: {weather.alerts[0].event}
              </AlertTitle>
              {weather.alerts[0].severity && (
                <Badge variant="destructive" className="h-4 text-[0.5625rem] px-1.5 font-bold uppercase">
                  {weather.alerts[0].severity}
                </Badge>
              )}
            </div>
            {weather.alerts[0].headline && (
              <AlertDescription className="text-xs text-rose-800/90 dark:text-rose-300 leading-snug">
                {weather.alerts[0].headline}
              </AlertDescription>
            )}
          </div>
        </Alert>
      )}

      {/* ── Unified Tiles Flex Container (Wraps & Resizes Together) ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        {/* Tile: Start Time */}
        <div style={TILE_STYLE}>
          <div style={TILE_LABEL_ROW}>
            <CalendarCheck size={14} style={{ color: '#16a34a' }} />
            <span style={TILE_LABEL}>Start</span>
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {!isNaN(startDate.getTime()) ? format(startDate, 'HH:mm') : '—'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 3 }}>
              {!isNaN(startDate.getTime()) ? format(startDate, 'EEE, MMM d') : ''}
            </div>
          </div>
        </div>

        {/* Tile: End Time */}
        <div style={TILE_STYLE}>
          <div style={TILE_LABEL_ROW}>
            <CalendarX size={14} style={{ color: '#dc2626' }} />
            <span style={TILE_LABEL}>End</span>
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {!isNaN(endDate.getTime()) ? format(endDate, 'HH:mm') : '—'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 3 }}>
              {!isNaN(endDate.getTime()) ? format(endDate, 'EEE, MMM d') : ''}
            </div>
          </div>
        </div>

        {/* Tile: Duration */}
        <div style={TILE_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={TILE_LABEL_ROW}>
              <Clock size={14} style={{ color: 'var(--navy-7)' }} />
              <span style={TILE_LABEL}>Duration</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {durationHours} <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-10)' }}>{durationHours === 1 ? 'hr' : 'hrs'}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 3 }}>
              {isMultiDay ? 'Multi-Day' : 'Operational Time'}
            </div>
          </div>
        </div>

        {/* ── Weather tiles (flow and wrap together with baseline tiles) ── */}
        {weather && (
          <>
            {/* Tile: Temperature Range */}
            <div style={getWeatherTileStyle(weather.safetyInsights.tempStatus, 0)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={TILE_LABEL_ROW}>
                  <Thermometer size={14} style={{ color: '#ea580c' }} />
                  <span>Temp</span>
                </div>
                {getStatusBadge('temp', weather.safetyInsights.tempStatus)}
              </div>

              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {weather.tempMin === weather.tempMax
                    ? `${weather.tempCurrent}°F`
                    : `${weather.tempMin}°–${weather.tempMax}°F`}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 3 }}>
                  {weather.tempCurrent}° · Feels {weather.feelsLike}°
                </div>
              </div>
            </div>

            {/* Tile: Wind & Gusts */}
            <div style={getWeatherTileStyle(weather.safetyInsights.windStatus, 40)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={TILE_LABEL_ROW}>
                  <Wind size={14} style={{ color: '#0284c7' }} />
                  <span>Wind</span>
                </div>
                {getStatusBadge('wind', weather.safetyInsights.windStatus)}
              </div>

              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {weather.windSpeed} <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-10)' }}>{weather.windDirection}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 3 }}>
                  {weather.windGustMph ? `Gusts to ${weather.windGustMph} mph` : 'Sustained winds'}
                </div>
              </div>
            </div>

            {/* Tile: Precipitation & Conditions */}
            <div style={getWeatherTileStyle(weather.safetyInsights.precipStatus, 80)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={TILE_LABEL_ROW}>
                  {getWeatherIcon(weather.primaryCondition)}
                  <span>Precip</span>
                </div>
                {getStatusBadge('precip', weather.safetyInsights.precipStatus)}
              </div>

              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--slate-12)', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {weather.precipChanceMax}% <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-10)' }}>PoP</span>
                </div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--slate-10)',
                    marginTop: 3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={weather.primaryCondition}
                >
                  {weather.primaryCondition}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Forecast validity footer ──────────────────────────── */}
      {weather && (
        <div
          style={{
            fontSize: '0.6875rem',
            color: 'var(--slate-8)',
            lineHeight: 1.4,
            animation: 'weatherEntrance 0.35s cubic-bezier(0.16, 1, 0.3, 1) 120ms both',
          }}
        >
          NOAA NWS forecast&nbsp;·&nbsp;Incident window&nbsp;·&nbsp;
          {formatValidityPeriod(weather.forecastStart, weather.forecastEnd)}
        </div>
      )}

      <style>{`
        @keyframes weatherEntrance {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
