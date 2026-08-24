import axios from 'axios';

/**
 * Hardcoded token fallback (if you prefer to put it directly in the codebase for local dev):
 */
export const HARDCODED_MAPBOX_TOKEN = '';

const GEOCODE_CACHE_KEY_PREFIX = 'mapbox_geocode_cache_';
const DRIVING_CACHE_KEY_PREFIX = 'mapbox_driving_cache_';

export function getMapboxToken(): string {
  return (
    (import.meta.env.VITE_MAPBOX_TOKEN as string) ||
    HARDCODED_MAPBOX_TOKEN ||
    ''
  );
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  placeName: string;
}

export interface DrivingRouteResult {
  durationSeconds: number;
  distanceMeters: number;
  durationFormatted: string;
  distanceFormatted: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

export interface MultiStopDrivingRouteResult {
  durationSeconds: number;
  distanceMeters: number;
  durationFormatted: string;
  distanceFormatted: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  legs: {
    durationSeconds: number;
    distanceMeters: number;
    durationFormatted: string;
    distanceFormatted: string;
  }[];
}

export function formatDrivingDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatDrivingDistance(meters: number): string {
  const miles = meters * 0.000621371;
  return `${miles.toFixed(1)} mi`;
}

export function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export const MAX_REASONABLE_DISTANCE_MILES = 350;

export const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours TTL for user locations and static routes
export const LIVE_TRAFFIC_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL for real-time "Leave Now" live traffic

export function getCacheTtlMs(depKey: string, departAt?: string): number {
  if (depKey === 'now' || departAt === 'now') {
    return LIVE_TRAFFIC_CACHE_TTL_MS;
  }
  return LOCATION_CACHE_TTL_MS;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// In-memory caches to prevent duplicate simultaneous in-flight queries
const inFlightGeocodes = new Map<string, Promise<GeocodeResult | null>>();
const inFlightRoutes = new Map<string, Promise<DrivingRouteResult | null>>();

function compactGeometry(geometry: any): any {
  if (!geometry || !Array.isArray(geometry.coordinates)) return geometry;
  return {
    type: geometry.type,
    coordinates: geometry.coordinates.map((coord: number[]) => [
      Math.round(coord[0] * 10000) / 10000,
      Math.round(coord[1] * 10000) / 10000,
    ]),
  };
}

export function safeSetLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota exceeded: prune expired entries first
    try {
      const now = Date.now();
      const allKeys = Object.keys(localStorage);
      for (const k of allKeys) {
        if (k.startsWith(DRIVING_CACHE_KEY_PREFIX) || k.startsWith(GEOCODE_CACHE_KEY_PREFIX)) {
          const item = localStorage.getItem(k);
          if (item) {
            try {
              const parsed = JSON.parse(item);
              if (parsed && typeof parsed.timestamp === 'number' && now - parsed.timestamp >= LOCATION_CACHE_TTL_MS) {
                localStorage.removeItem(k);
              }
            } catch {
              localStorage.removeItem(k);
            }
          }
        }
      }

      // Retry after expired eviction
      localStorage.setItem(key, value);
    } catch {
      // If still full, prune oldest driving route caches (LRU eviction)
      try {
        const routeKeys: { key: string; timestamp: number }[] = [];
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith(DRIVING_CACHE_KEY_PREFIX)) {
            const item = localStorage.getItem(k);
            if (item) {
              try {
                const parsed = JSON.parse(item);
                routeKeys.push({ key: k, timestamp: parsed.timestamp || 0 });
              } catch {
                localStorage.removeItem(k);
              }
            }
          }
        }

        // Sort oldest first and remove oldest half
        routeKeys.sort((a, b) => a.timestamp - b.timestamp);
        const removeCount = Math.max(1, Math.floor(routeKeys.length / 2));
        for (let i = 0; i < removeCount; i++) {
          localStorage.removeItem(routeKeys[i].key);
        }

        localStorage.setItem(key, value);
      } catch {
        // Fallback gracefully
      }
    }
  }
}

export async function geocodeAddress(addressText: string, customToken?: string): Promise<GeocodeResult | null> {
  const query = addressText.trim();
  if (!query) return null;

  const token = customToken || getMapboxToken();
  if (!token) {
    console.warn(`[Mapbox Geocode] No Mapbox token available for query: "${query}"`);
    return null;
  }

  const cacheKey = `${GEOCODE_CACHE_KEY_PREFIX}${encodeURIComponent(query.toLowerCase())}`;

  // Check localStorage cache with 24-hour TTL
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.timestamp === 'number') {
        if (Date.now() - parsed.timestamp < LOCATION_CACHE_TTL_MS) {
          return parsed.data as GeocodeResult | null;
        } else {
          localStorage.removeItem(cacheKey);
        }
      } else if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        // Legacy cache format without timestamp
        return parsed as GeocodeResult;
      }
    }
  } catch { }

  // Check in-flight
  if (inFlightGeocodes.has(query)) {
    return inFlightGeocodes.get(query)!;
  }

  const promise = (async (): Promise<GeocodeResult | null> => {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`;
      const res = await axios.get(url, {
        params: {
          access_token: token,
          limit: 1,
          types: 'address,postcode,place,locality,poi',
          country: 'US',
        },
      });

      const feature = res.data?.features?.[0];
      if (feature && Array.isArray(feature.center) && feature.center.length >= 2) {
        const [lng, lat] = feature.center;
        const result: GeocodeResult = {
          lat,
          lng,
          placeName: feature.place_name || query,
        };

        const entry: CacheEntry<GeocodeResult> = { data: result, timestamp: Date.now() };
        safeSetLocalStorageItem(cacheKey, JSON.stringify(entry));
        return result;
      } else {
        // Cache negative result with TTL to avoid re-querying invalid addresses repeatedly
        const entry: CacheEntry<null> = { data: null, timestamp: Date.now() };
        safeSetLocalStorageItem(cacheKey, JSON.stringify(entry));
      }
    } catch (e: any) {
      console.warn(`[Mapbox Geocode] Failed to geocode "${query}":`, e.response?.status, e.response?.data || e.message);
    }
    return null;
  })().finally(() => {
    inFlightGeocodes.delete(query);
  });

  inFlightGeocodes.set(query, promise);
  return promise;
}

export type DepartureWindowMode = 'baseline' | 'now' | 'activity_start' | 'morning_rush' | 'midday' | 'evening_rush';

export interface RouteOptions {
  customToken?: string;
  departAt?: string;
  profile?: 'driving' | 'driving-traffic';
  departureKey?: string;
}

export async function getDrivingRoute(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
  optionsOrToken?: string | RouteOptions
): Promise<DrivingRouteResult | null> {
  const options: RouteOptions =
    typeof optionsOrToken === 'string'
      ? { customToken: optionsOrToken }
      : optionsOrToken || {};

  const token = options.customToken || getMapboxToken();
  if (!token) return null;

  const profile = options.profile || 'driving';
  const depKey = options.departureKey || (profile === 'driving' ? 'baseline' : 'traffic');

  // Round to 4 decimal places (~11 meters) for robust cache hits
  const originKey = `${origin.lng.toFixed(4)},${origin.lat.toFixed(4)}`;
  const destKey = `${destination.lng.toFixed(4)},${destination.lat.toFixed(4)}`;
  const cacheKey = `${DRIVING_CACHE_KEY_PREFIX}${depKey}_${originKey}_${destKey}`;
  const legacyKey = `${DRIVING_CACHE_KEY_PREFIX}${originKey}_${destKey}`;

  // Check localStorage cache with 24-hour (or 15-min for leave now) TTL
  const ttl = getCacheTtlMs(depKey, options.departAt);
  try {
    const cached = localStorage.getItem(cacheKey) || (depKey === 'baseline' ? localStorage.getItem(legacyKey) : null);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.timestamp === 'number') {
        if (Date.now() - parsed.timestamp < ttl) {
          return parsed.data as DrivingRouteResult | null;
        } else {
          localStorage.removeItem(cacheKey);
        }
      } else if (parsed && typeof parsed.durationSeconds === 'number') {
        return parsed as DrivingRouteResult;
      }
    }
  } catch { }

  // Check in-flight
  if (inFlightRoutes.has(cacheKey)) {
    return inFlightRoutes.get(cacheKey)!;
  }

  const promise = (async (): Promise<DrivingRouteResult | null> => {
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
      const params: Record<string, string> = {
        access_token: token,
        geometries: 'geojson',
        overview: 'full',
      };

      if (profile === 'driving-traffic' && options.departAt) {
        params.depart_at = options.departAt;
      }

      const res = await axios.get(url, { params });

      const route = res.data?.routes?.[0];
      if (route && typeof route.duration === 'number' && typeof route.distance === 'number') {
        const result: DrivingRouteResult = {
          durationSeconds: route.duration,
          distanceMeters: route.distance,
          durationFormatted: formatDrivingDuration(route.duration),
          distanceFormatted: formatDrivingDistance(route.distance),
          geometry: compactGeometry(route.geometry),
        };

        const entry: CacheEntry<DrivingRouteResult> = { data: result, timestamp: Date.now() };
        safeSetLocalStorageItem(cacheKey, JSON.stringify(entry));

        return result;
      }
    } catch (e) {
      console.warn(`[Mapbox Directions] Failed to route from [${originKey}] to [${destKey}]:`, e);
    }
    return null;
  })().finally(() => {
    inFlightRoutes.delete(cacheKey);
  });

  inFlightRoutes.set(cacheKey, promise);
  return promise;
}

export async function getMultiStopDrivingRoute(
  stops: { lng: number; lat: number }[],
  optionsOrToken?: string | RouteOptions
): Promise<MultiStopDrivingRouteResult | null> {
  if (!stops || stops.length < 2) return null;

  const options: RouteOptions =
    typeof optionsOrToken === 'string'
      ? { customToken: optionsOrToken }
      : optionsOrToken || {};

  const token = options.customToken || getMapboxToken();
  if (!token) return null;

  const profile = options.profile || 'driving';
  const depKey = options.departureKey || (profile === 'driving' ? 'baseline' : 'traffic');

  const keyCoords = stops.map(s => `${s.lng.toFixed(4)},${s.lat.toFixed(4)}`).join(';');
  const cacheKey = `${DRIVING_CACHE_KEY_PREFIX}multi_${depKey}_${keyCoords}`;
  const legacyKey = `${DRIVING_CACHE_KEY_PREFIX}multi_${keyCoords}`;

  const ttl = getCacheTtlMs(depKey, options.departAt);
  try {
    const cached = localStorage.getItem(cacheKey) || (depKey === 'baseline' ? localStorage.getItem(legacyKey) : null);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.timestamp === 'number') {
        if (Date.now() - parsed.timestamp < ttl) {
          return parsed.data as MultiStopDrivingRouteResult | null;
        } else {
          localStorage.removeItem(cacheKey);
        }
      } else if (parsed && typeof parsed.durationSeconds === 'number') {
        return parsed as MultiStopDrivingRouteResult;
      }
    }
  } catch {}

  if (inFlightRoutes.has(cacheKey)) {
    return inFlightRoutes.get(cacheKey) as Promise<MultiStopDrivingRouteResult | null>;
  }

  const promise = (async (): Promise<MultiStopDrivingRouteResult | null> => {
    try {
      const coordsString = stops.map(s => `${s.lng},${s.lat}`).join(';');
      const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordsString}`;
      const params: Record<string, string> = {
        access_token: token,
        geometries: 'geojson',
        overview: 'full',
      };

      if (profile === 'driving-traffic' && options.departAt) {
        params.depart_at = options.departAt;
      }

      const res = await axios.get(url, { params });

      const route = res.data?.routes?.[0];
      if (route && route.geometry) {
        const legs = (route.legs || []).map((l: { duration: number; distance: number }) => ({
          durationSeconds: l.duration,
          distanceMeters: l.distance,
          durationFormatted: formatDrivingDuration(l.duration),
          distanceFormatted: formatDrivingDistance(l.distance),
        }));

        const result: MultiStopDrivingRouteResult = {
          durationSeconds: route.duration,
          distanceMeters: route.distance,
          durationFormatted: formatDrivingDuration(route.duration),
          distanceFormatted: formatDrivingDistance(route.distance),
          geometry: compactGeometry(route.geometry),
          legs,
        };

        const entry: CacheEntry<MultiStopDrivingRouteResult> = { data: result, timestamp: Date.now() };
        safeSetLocalStorageItem(cacheKey, JSON.stringify(entry));

        return result;
      }
    } catch (e) {
      console.warn('[Mapbox MultiStop Directions] Failed:', e);
    }
    return null;
  })().finally(() => {
    inFlightRoutes.delete(cacheKey);
  });

  inFlightRoutes.set(cacheKey, promise as Promise<DrivingRouteResult | null>);
  return promise;
}

export function isDrivingRouteCached(
  origin: { lng: number; lat: number },
  destination: { lng: number; lat: number },
  optionsOrToken?: string | RouteOptions
): boolean {
  const options: RouteOptions =
    typeof optionsOrToken === 'string'
      ? { customToken: optionsOrToken }
      : optionsOrToken || {};

  const profile = options.profile || 'driving';
  const depKey = options.departureKey || (profile === 'driving' ? 'baseline' : 'traffic');

  const originKey = `${origin.lng.toFixed(4)},${origin.lat.toFixed(4)}`;
  const destKey = `${destination.lng.toFixed(4)},${destination.lat.toFixed(4)}`;
  const cacheKey = `${DRIVING_CACHE_KEY_PREFIX}${depKey}_${originKey}_${destKey}`;
  const legacyKey = `${DRIVING_CACHE_KEY_PREFIX}${originKey}_${destKey}`;

  const ttl = getCacheTtlMs(depKey, options.departAt);
  try {
    const cached = localStorage.getItem(cacheKey) || (depKey === 'baseline' ? localStorage.getItem(legacyKey) : null);
    if (!cached) return false;
    const parsed = JSON.parse(cached);
    if (parsed && typeof parsed.timestamp === 'number') {
      return Date.now() - parsed.timestamp < ttl;
    }
    return typeof parsed?.durationSeconds === 'number';
  } catch {
    return false;
  }
}

export function isMultiStopRouteCached(
  stops: { lng: number; lat: number }[],
  optionsOrToken?: string | RouteOptions
): boolean {
  if (!stops || stops.length < 2) return false;

  const options: RouteOptions =
    typeof optionsOrToken === 'string'
      ? { customToken: optionsOrToken }
      : optionsOrToken || {};

  const profile = options.profile || 'driving';
  const depKey = options.departureKey || (profile === 'driving' ? 'baseline' : 'traffic');

  const keyCoords = stops.map(s => `${s.lng.toFixed(4)},${s.lat.toFixed(4)}`).join(';');
  const cacheKey = `${DRIVING_CACHE_KEY_PREFIX}multi_${depKey}_${keyCoords}`;
  const legacyKey = `${DRIVING_CACHE_KEY_PREFIX}multi_${keyCoords}`;

  const ttl = getCacheTtlMs(depKey, options.departAt);
  try {
    const cached = localStorage.getItem(cacheKey) || (depKey === 'baseline' ? localStorage.getItem(legacyKey) : null);
    if (!cached) return false;
    const parsed = JSON.parse(cached);
    if (parsed && typeof parsed.timestamp === 'number') {
      return Date.now() - parsed.timestamp < ttl;
    }
    return typeof parsed?.durationSeconds === 'number';
  } catch {
    return false;
  }
}
