import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

interface ActivityMiniMapProps {
  lat?: number | null;
  lng?: number | null;
  locationName?: string;
  height?: number;
}

export const ActivityMiniMap: React.FC<ActivityMiniMapProps> = ({
  lat,
  lng,
  locationName,
  height = 120,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const hasValidCoords =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    (lat !== 0 || lng !== 0);

  useEffect(() => {
    if (!hasValidCoords || !mapContainerRef.current || lat == null || lng == null) {
      return;
    }

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    try {
      const map = L.map(mapContainerRef.current, {
        center: [lat, lng],
        zoom: 13,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: true,
      });
      mapInstanceRef.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Custom SVG pin
      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="
          width: 24px;
          height: 24px;
          background: #0d2d66;
          border: 2.5px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        "><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
      if (locationName) {
        marker.bindPopup(`<div style="font-size:12px; font-weight:600; padding:2px;">${locationName}</div>`);
      }

      const timer = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      }, 150);

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        resizeObserver = new ResizeObserver(() => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.invalidateSize();
          }
        });
        resizeObserver.observe(mapContainerRef.current);
      }

      return () => {
        clearTimeout(timer);
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
      };
    } catch (e) {
      console.warn('Leaflet map initialization error:', e);
    }
  }, [hasValidCoords, lat, lng, locationName]);

  if (!hasValidCoords) {
    if (!locationName) return null;
    return (
      <div
        style={{
          padding: '8px 10px',
          background: 'var(--slate-2)',
          border: '1px solid var(--slate-4)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: '0.8125rem',
          color: 'var(--slate-11)',
        }}
      >
        <MapPin size={13} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {locationName}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      style={{
        height,
        width: '100%',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--slate-4)',
        zIndex: 0,
      }}
    />
  );
};
