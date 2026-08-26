import axios from 'axios';
import { addDays, differenceInCalendarDays, isSameDay, subDays } from 'date-fns';
import { safeSetLocalStorageItem } from './storage';

const BASE_URL = 'https://api.team-manager.us.d4h.com/v3';
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes for members and qualifications (per AGENTS.md)
const ACTIVITIES_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes for activity lists

// In-flight promise cache to deduplicate simultaneous requests
const inFlightRequests = new Map<string, Promise<any>>();

function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => inFlightRequests.delete(key));
  inFlightRequests.set(key, promise);
  return promise;
}

// Setup axios instance
export const api = axios.create({
  baseURL: BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('d4h_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('d4h_token');
      localStorage.removeItem('d4h_context_id');
      localStorage.removeItem('d4h_team_title');

      if (!window.location.pathname.includes('/connect-d4h')) {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const connectUrl = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + 'connect-d4h';
        window.location.href = connectUrl;
      }
      return Promise.reject(error);
    }

    // Handle 429 Rate Limiting with retry
    if (error.response && error.response.status === 429 && !error.config._retry) {
      error.config._retry = true;
      const retryAfterHeader = error.response.headers['retry-after'];
      const delaySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 10;
      const delayMs = (!isNaN(delaySec) && delaySec > 0 ? delaySec : 10) * 1000;
      console.warn(`[D4H API] Rate limited (429). Retrying in ${delayMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return api.request(error.config);
    }

    return Promise.reject(error);
  }
);

export function getD4HErrorMessage(err: any, fallback = 'Failed to connect to D4H'): string {
  if (!err) return fallback;

  // Explicit message provided in D4H response body
  const serverMsg = err.response?.data?.message || err.response?.data?.error || err.response?.data?.error_description;
  if (serverMsg && typeof serverMsg === 'string' && serverMsg.trim()) {
    return serverMsg;
  }

  // HTTP status code handling
  const status = err.response?.status;
  if (status === 401) {
    return 'Invalid or expired personal access token. Please verify your token at myaccount.us.d4h.com and try again.';
  }
  if (status === 403) {
    return 'Access forbidden. Your D4H token does not have permission to access this team or resource.';
  }
  if (status === 404) {
    return 'D4H resource or team organization not found. Please verify your account configuration.';
  }
  if (status === 429) {
    return 'D4H API rate limit reached. Please wait a few seconds and try again.';
  }
  if (status >= 500) {
    return 'D4H servers returned an error. Please try again in a few moments.';
  }

  // Axios network error / CORS / Connection error
  if (err.message === 'Network Error' || err.code === 'ERR_NETWORK') {
    return 'There was an error. This can happen if the token is invalid, your device is offline, or the connection was blocked.';
  }
  if (err.code === 'ECONNABORTED' || err.message?.toLowerCase().includes('timeout')) {
    return 'Request to D4H timed out. Please check your internet connection and try again.';
  }

  // Custom client-side Error instance
  if (err.message && typeof err.message === 'string' && err.message !== 'Network Error') {
    return err.message;
  }

  return fallback;
}

export interface WhoAmIResponse {
  id?: number;
  name?: string;
  username?: string;
  email?: string;
  members: {
    id?: number;
    owner: {
      id: number;
      resourceType: string;
      title: string;
    };
    name: string;
    role?: {
      id?: number;
      title?: string;
      permission?: string;
      resourceType?: string;
    };
    position?: string;
    status?: string;
    permission?: string;
    permissions?: string[] | Record<string, any>;
    [key: string]: any;
  }[];
  [key: string]: any;
}

export interface ActivityAttachment {
  id: number;
  title?: string;
  filename?: string;
  name?: string;
  fileExt?: string;
  fileType?: string;
  fileSize?: number;
  size?: number; // bytes
  mimeType?: string;
  contentType?: string;
  url?: string;
  downloadUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  availableSizes?: string[];
  targetResource?: {
    resourceType?: string;
    id?: number;
    deleted?: boolean;
  };
  createdBy?: { id: number; resourceType?: string };
  [key: string]: any;
}

export interface Activity {
  type: 'exercise' | 'event' | 'incident';
  id: number;
  reference?: string;
  referenceDescription?: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  address?: {
    street?: string;
    town?: string;
    region?: string;
    postcode?: string;
    country?: string;
  };
  location?: {
    type: string;
    coordinates: number[];
  };
  countAttendance?: number;
  attachments?: ActivityAttachment[];
  documents?: ActivityAttachment[];
}

export function getActivityStreetAddress(activity?: Partial<Activity>): string | null {
  if (!activity) return null;
  const street = activity.address?.street?.trim();
  const town = activity.address?.town?.trim();

  // A street address MUST have a house/building number (e.g. "610 Old Mason Street").
  // Generic street names without house numbers (e.g. "Pacific Ave") or park/town names
  // should not be treated as a specific street destination.
  if (street && /^\s*\d+[\w-]*\s+[A-Za-z]/i.test(street)) {
    if (town && !street.toLowerCase().includes(town.toLowerCase())) {
      return `${street}, ${town}`;
    }
    return street;
  }
  return null;
}

export function formatActivityLocation(
  activity?: Partial<Activity>,
  options?: { allowCoordinates?: boolean }
): string {
  if (!activity) return '';

  const streetAddress = getActivityStreetAddress(activity);
  if (streetAddress) {
    return streetAddress;
  }

  const street = activity.address?.street?.trim();
  const town = activity.address?.town?.trim();
  const region = activity.address?.region?.trim();

  // Street name even without building number (e.g., "Bald Rock Rd")
  if (street) {
    if (town && !street.toLowerCase().includes(town.toLowerCase())) {
      return `${street}, ${town}`;
    }
    return street;
  }

  // Town & Region (e.g., "Berry Creek, CA" or "Richmond")
  if (town) {
    if (region && !town.toLowerCase().includes(region.toLowerCase())) {
      return `${town}, ${region}`;
    }
    return town;
  }

  // Extract county from title/description if enclosed in parentheses (e.g. "(Placer)", "(Butte)", "(San Mateo)")
  const title = (activity.referenceDescription || activity.description || '').trim();
  const countyMatch = title.match(/\(([A-Za-z\s]+)\)/);
  if (countyMatch && countyMatch[1]) {
    const candidate = countyMatch[1].trim();
    if (!/^(canceled|cancelled|draft|pending|exercise|event|incident|closed|archive)$/i.test(candidate)) {
      return /county/i.test(candidate) ? candidate : `${candidate} County`;
    }
  }

  if (region) {
    return region;
  }

  // Only show coordinates if explicitly requested (e.g. in map coordinate inspect tool), never in standard list views
  if (
    options?.allowCoordinates &&
    activity.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [lng, lat] = activity.location.coordinates;
    if (lat !== 0 || lng !== 0) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  return '';
}

export interface Attendee {
  id: number;
  status: string; // 'ATTENDING', 'REQUESTED', etc.
  member: {
    id: number;
    resourceType: string;
    name?: string;
  };
  role?: {
    id?: number;
    title?: string;
    resourceType?: string;
  };
  startsAt?: string;
  endsAt?: string;
  duration?: number;
  hours?: number;
}

// Full member info
export interface Member {
  id: number;
  name: string;
  ref?: string;
  idTag?: string;
  status?: string;
  customStatus?: { id?: number; title?: string; resourceType?: string };
  role?: { id?: number; title?: string; resourceType?: string };
  position?: string;
  email?: string | { value?: string; verified?: boolean; email?: string };
  mobile?: { phone?: string };
  home?: { phone?: string };
  work?: { phone?: string };
  pager?: { phone?: string };
  address?: {
    street?: string;
    town?: string;
    region?: string;
    postcode?: string;
    country?: string;
  };
  deprecatedAddress?: string;
  location?: {
    type?: string;
    coordinates?: number[]; // [lng, lat]
  };
  customFieldValues?: {
    customField: {
      id: number;
      title?: string;
      type: string;
      [key: string]: any;
    };
    value: any;
  }[];
}

/**
 * Extracts the user's operational region from D4H custom fields or address (e.g. "East Bay", "South Bay", "North Bay", "San Francisco / Peninsula").
 */
export function extractMemberRegion(member?: Partial<Member>): string {
  if (!member) return '';

  // 1. Check customFieldValues for Region field (ID 6328 or title matching "region" / "area")
  if (Array.isArray(member.customFieldValues)) {
    const regionEntry = member.customFieldValues.find(
      (cf) =>
        cf.customField?.id === 6328 ||
        cf.customField?.title?.toLowerCase().includes('region') ||
        cf.customField?.title?.toLowerCase().includes('area')
    );
    if (regionEntry) {
      const val = regionEntry.value;
      const options = (regionEntry.customField as any)?.options || (regionEntry.customField as any)?.choices;

      const resolveOption = (raw: any): string => {
        if (raw === undefined || raw === null) return '';
        if (typeof raw === 'object') {
          if (typeof raw.value === 'string' && raw.value.trim()) return raw.value.trim();
          if (typeof raw.label === 'string' && raw.label.trim()) return raw.label.trim();
          if (typeof raw.title === 'string' && raw.title.trim()) return raw.title.trim();
          if (raw.id !== undefined) return resolveOption(raw.id);
        }

        const strVal = String(raw).trim();
        const numId = parseInt(strVal, 10);

        if (Array.isArray(options)) {
          const opt = options.find((o: any) =>
            String(o.id) === strVal ||
            String(o.value) === strVal ||
            (o.id !== undefined && !isNaN(numId) && o.id === numId)
          );
          if (opt && (opt.value || opt.label || opt.title)) {
            return opt.value || opt.label || opt.title;
          }
        }

        if (!isNaN(numId)) {
          if (numId === 14810) return 'East Bay';
          if (numId === 14811) return 'South Bay';
          if (numId === 14812) return 'San Francisco / Peninsula';
          if (numId === 14813) return 'North Bay';
          if (numId === 14814) return 'Other State';
          if (numId === 14815) return 'Other Country';
        }

        return strVal;
      };

      if (Array.isArray(val) && val.length > 0) {
        const resolved = resolveOption(val[0]);
        if (resolved) return resolved;
      } else if (val !== undefined && val !== null) {
        const resolved = resolveOption(val);
        if (resolved) return resolved;
      }
    }
  }

  // 2. Check standard address region / state
  if (member.address?.region && typeof member.address.region === 'string' && member.address.region.trim()) {
    return member.address.region.trim();
  }

  return '';
}

/**
 * Checks if a member is out-of-state or international based on their D4H custom fields or address.
 */
export function isMemberOutOfStateOrCountry(member?: Partial<Member>): boolean {
  if (!member) return false;

  // 1. Check Region custom field (ID 6328)
  if (Array.isArray(member.customFieldValues)) {
    const regionEntry = member.customFieldValues.find(
      cf => cf.customField?.id === 6328 || cf.customField?.title?.toLowerCase().includes('region')
    );
    if (regionEntry && regionEntry.value) {
      const valArr = Array.isArray(regionEntry.value) ? regionEntry.value : [regionEntry.value];
      // 14814 = "Other State", 14815 = "Other Country"
      if (valArr.includes(14814) || valArr.includes(14815)) {
        return true;
      }
    }
  }

  // 2. Check international postal codes (e.g. Canadian "V5T 3R8")
  if (Array.isArray(member.customFieldValues)) {
    const zipEntry = member.customFieldValues.find(
      cf => cf.customField?.id === 5778 || cf.customField?.title?.toLowerCase().includes('zip')
    );
    if (zipEntry && zipEntry.value) {
      const zipStr = String(zipEntry.value).trim();
      // Canadian postal code pattern: Letter-Digit-Letter Digit-Letter-Digit
      if (/^[A-Z]\d[A-Z]/i.test(zipStr)) {
        return true;
      }
    }
  }

  // 3. Check address country if specified
  if (member.address?.country) {
    const c = member.address.country.trim().toLowerCase();
    if (c && c !== 'usa' && c !== 'us' && c !== 'united states' && c !== 'united states of america') {
      return true;
    }
  }

  return false;
}

/**
 * Extracts the best geocodable location query (address, zip code, or region) from a D4H Member object.
 * Returns empty string if the member is out of state/area or has no location.
 */
export function getMemberLocationQuery(member?: Partial<Member>): string {
  if (!member) return '';

  // Skip out-of-state or international members
  if (isMemberOutOfStateOrCountry(member)) {
    return '';
  }

  // 1. Check deprecatedAddress
  if (member.deprecatedAddress && typeof member.deprecatedAddress === 'string' && member.deprecatedAddress.trim()) {
    return member.deprecatedAddress.trim();
  }

  // 2. Check structured address object
  if (member.address) {
    const parts = [
      member.address.street,
      member.address.town,
      member.address.region,
      member.address.postcode,
      member.address.country,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }

  // 3. Check customFieldValues for Zip Code (Field ID 5778)
  if (Array.isArray(member.customFieldValues)) {
    const zipEntry = member.customFieldValues.find(
      cf => cf.customField?.id === 5778 || cf.customField?.title?.toLowerCase().includes('zip')
    );
    if (zipEntry && zipEntry.value) {
      const zipVal = String(zipEntry.value).trim();
      if (zipVal && /^\d{5}/.test(zipVal)) {
        return zipVal;
      }
    }
  }

  return '';
}

export const logCurrentUserInfo = async (): Promise<void> => {
  if (!import.meta.env.DEV) return;
  try {
    const token = localStorage.getItem('d4h_token');
    if (!token) return;
    const res = await api.get<WhoAmIResponse>('/whoami');
    console.groupCollapsed(
      '%c[D4H Auth] Logged-in User & Permissions',
      'color: #0d2d66; font-weight: bold; background: #e0f2fe; padding: 2px 6px; border-radius: 4px;'
    );
    if (Array.isArray(res.data?.members)) {
      res.data.members.forEach((m, idx) => {
        console.log(`Team/Context #${idx + 1} (${m.owner?.title || 'Unknown'} - ID: ${m.owner?.id}):`, {
          memberName: m.name,
          memberId: m.id,
          role: m.role,
          permission: m.permission,
          permissions: m.permissions,
          position: m.position,
          status: m.status,
          owner: m.owner,
        });
      });
    } else {
      console.log('WhoAmI Full Response:', res.data);
    }
    console.groupEnd();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[D4H Auth] Could not fetch user permissions info:', err);
    }
  }
};

export const verifyTokenAndGetContext = async (): Promise<{ contextId: number; title: string }> => {
  const res = await api.get<WhoAmIResponse>('/whoami');
  const member = res.data.members.find((m) => m.owner.resourceType === 'Team');
  if (!member) {
    throw new Error("No Team context found for this token.");
  }

  if (member.id) {
    localStorage.setItem('d4h_member_id', member.id.toString());
  }
  if (member.name) {
    localStorage.setItem('d4h_member_name', member.name);
  }

  // Pre-cache fallback subdomain based on title so we avoid unnecessary network calls
  const fallbackSubdomain = member.owner.title.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  localStorage.setItem('d4h_team_subdomain', fallbackSubdomain);

  // Log user info and permissions in dev mode
  if (import.meta.env.DEV) {
    logCurrentUserInfo();
  }

  return { contextId: member.owner.id, title: member.owner.title };
};

export interface CurrentUserMemberInfo {
  memberId: number;
  name?: string;
}

export const getCurrentUserMemberInfo = async (contextId?: number | string): Promise<CurrentUserMemberInfo | null> => {
  const cachedMemberId = localStorage.getItem('d4h_member_id');
  const cachedMemberName = localStorage.getItem('d4h_member_name');
  if (cachedMemberId) {
    const id = parseInt(cachedMemberId, 10);
    if (!isNaN(id)) {
      return { memberId: id, name: cachedMemberName || undefined };
    }
  }

  try {
    const res = await api.get<WhoAmIResponse>('/whoami');
    const targetContextId = contextId ? Number(contextId) : null;
    const member = targetContextId
      ? res.data.members?.find(m => m.owner.id === targetContextId)
      : res.data.members?.find(m => m.owner.resourceType === 'Team') || res.data.members?.[0];

    if (member && member.id) {
      localStorage.setItem('d4h_member_id', member.id.toString());
      if (member.name) {
        localStorage.setItem('d4h_member_name', member.name);
      }
      return { memberId: member.id, name: member.name };
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[D4H Auth] Failed to get current user info:', e);
    }
  }
  return null;
};

// In-memory cache for current user attendance lists (15m TTL)
const userAttendanceCache = new Map<string, { ids: Set<number>; cachedAt: number }>();

export const getCurrentUserAttendingActivityIds = async (
  contextId: number,
  options?: { startsAfter?: string; startsBefore?: string; forceRefresh?: boolean }
): Promise<Set<number>> => {
  const userInfo = await getCurrentUserMemberInfo(contextId);
  if (!userInfo?.memberId) return new Set();

  const cacheKey = `attending_${contextId}_${userInfo.memberId}_${options?.startsAfter || ''}_${options?.startsBefore || ''}`;

  if (!options?.forceRefresh) {
    const cached = userAttendanceCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ACTIVITIES_CACHE_TTL_MS) {
      return cached.ids;
    }
  }

  return dedupe(cacheKey, async () => {
    try {
      const params: Record<string, any> = {
        member_id: userInfo.memberId,
        size: 250,
      };
      if (options?.startsAfter) params.starts_after = options.startsAfter;
      if (options?.startsBefore) params.starts_before = options.startsBefore;

      const res = await api.get<{ results: any[] }>(`/team/${contextId}/attendance`, { params });
      const results = res.data?.results || [];

      const attendingIds = new Set<number>();
      results.forEach((rec) => {
        const status = (rec.status || '').toUpperCase();
        if (status === 'ATTENDING' || status === 'CONFIRMED') {
          const actId = rec.activity_id || rec.activity?.id || rec.id;
          if (typeof actId === 'number') {
            attendingIds.add(actId);
          }
        }
      });

      userAttendanceCache.set(cacheKey, { ids: attendingIds, cachedAt: Date.now() });
      return attendingIds;
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('[D4H API] Failed to fetch current user attendance:', e);
      }
      return new Set<number>();
    }
  });
};

export async function fetchAndCacheTeamSubdomain(_contextId?: string | number): Promise<string | null> {
  const cached = localStorage.getItem('d4h_team_subdomain');
  if (cached) return cached;

  const teamTitle = localStorage.getItem('d4h_team_title');
  const fallback = teamTitle ? teamTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '') : 'calsar';
  localStorage.setItem('d4h_team_subdomain', fallback);
  return fallback;
}

export function getD4HActivityUrl(activityId: number | string, activityType?: string): string {
  const typePlural = activityType === 'event' ? 'events' : activityType === 'incident' ? 'incidents' : 'exercises';
  let subdomain = localStorage.getItem('d4h_team_subdomain');
  if (!subdomain) {
    const teamTitle = localStorage.getItem('d4h_team_title');
    if (teamTitle) {
      subdomain = teamTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    }
  }
  const host = subdomain ? `${subdomain}.team-manager.us.d4h.com` : 'team-manager.us.d4h.com';
  return `https://${host}/team/${typePlural}/view/${activityId}`;
}

export function getD4HMemberUrl(memberId: number | string): string {
  let subdomain = localStorage.getItem('d4h_team_subdomain');
  if (!subdomain) {
    const teamTitle = localStorage.getItem('d4h_team_title');
    if (teamTitle) {
      subdomain = teamTitle.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
    }
  }
  const host = subdomain ? `${subdomain}.team-manager.us.d4h.com` : 'team-manager.us.d4h.com';
  return `https://${host}/team/members/view/${memberId}`;
}

// In-memory cache for activity lists (cleared on browser reload)
const activityListCache = new Map<string, { results: Activity[]; cachedAt: number }>();

export const getActivities = async (
  contextId: number,
  options?: { startsAfter?: string; startsBefore?: string; forceRefresh?: boolean }
): Promise<Activity[]> => {
  let starts_after: string;
  if (options?.startsAfter) {
    starts_after = options.startsAfter;
  } else {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    starts_after = oneWeekAgo.toISOString();
  }

  const cacheKey = `${contextId}_${starts_after}_${options?.startsBefore || ''}`;
  const localCacheKey = `d4h_activities_cache_${cacheKey}`;

  // Check in-memory and localStorage cache unless forceRefresh is requested
  if (!options?.forceRefresh) {
    const cached = activityListCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ACTIVITIES_CACHE_TTL_MS) {
      let list = cached.results;
      if (options?.startsBefore) {
        const beforeMs = new Date(options.startsBefore).getTime();
        list = list.filter(a => new Date(a.startsAt).getTime() <= beforeMs);
      }
      return list;
    }

    try {
      const stored = localStorage.getItem(localCacheKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.results) && Date.now() - (parsed.cachedAt || 0) < ACTIVITIES_CACHE_TTL_MS) {
          activityListCache.set(cacheKey, { results: parsed.results, cachedAt: parsed.cachedAt });
          let list = parsed.results;
          if (options?.startsBefore) {
            const beforeMs = new Date(options.startsBefore).getTime();
            list = list.filter((a: Activity) => new Date(a.startsAt).getTime() <= beforeMs);
          }
          return list;
        }
      }
    } catch { }
  }

  const dedupeKey = `getActivities_${cacheKey}`;
  return dedupe(dedupeKey, async () => {
    const params: Record<string, any> = {
      starts_after,
      sort: 'startsAt',
      order: 'asc',
      size: 250,
    };

    const [exercisesRes, eventsRes, incidentsRes] = await Promise.all([
      api.get<{ results: Activity[] }>(`/team/${contextId}/exercises`, { params }).catch((e) => { console.warn('Failed to fetch exercises:', e); return { data: { results: [] } }; }),
      api.get<{ results: Activity[] }>(`/team/${contextId}/events`, { params }).catch((e) => { console.warn('Failed to fetch events:', e); return { data: { results: [] } }; }),
      api.get<{ results: Activity[] }>(`/team/${contextId}/incidents`, { params }).catch((e) => { console.warn('Failed to fetch incidents:', e); return { data: { results: [] } }; }),
    ]);

    const exercises = (exercisesRes.data.results || []).map(r => ({ ...r, type: 'exercise' as const }));
    const events = (eventsRes.data.results || []).map(r => ({ ...r, type: 'event' as const }));
    const incidents = (incidentsRes.data.results || []).map(r => ({ ...r, type: 'incident' as const }));

    const allActivities = [...exercises, ...events, ...incidents];

    // Cache to global activity item cache
    try {
      const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      allActivities.forEach(a => { itemCache[a.id] = a; });
      localStorage.setItem('d4h_activity_cache', JSON.stringify(itemCache));
    } catch { }

    // Find activities with local changes
    const editedActivities: Activity[] = [];
    try {
      const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('d4h_form_') && !key.startsWith('d4h_form_local_') && !key.startsWith('d4h_form_type_')) {
          const idStr = key.replace('d4h_form_', '');
          const id = parseInt(idStr, 10);
          if (!isNaN(id) && !allActivities.some(a => a.id === id) && itemCache[id]) {
            editedActivities.push(itemCache[id]);
          }
        }
      }
    } catch { }

    let finalActivities = [...allActivities, ...editedActivities];
    finalActivities.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const uniqueActivities = Array.from(new Map(finalActivities.map(a => [a.id, a])).values());

    // Store in in-memory and persistent localStorage cache with TTL
    const now = Date.now();
    activityListCache.set(cacheKey, { results: uniqueActivities, cachedAt: now });
    try {
      localStorage.setItem(localCacheKey, JSON.stringify({ results: uniqueActivities, cachedAt: now }));
    } catch {
      // Quota exceeded: clean up oldest d4h_activities_cache_ entries and retry
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith('d4h_activities_cache_') && k !== localCacheKey) {
            localStorage.removeItem(k);
          }
        }
        localStorage.setItem(localCacheKey, JSON.stringify({ results: uniqueActivities, cachedAt: now }));
      } catch { }
    }

    if (options?.startsBefore) {
      const beforeMs = new Date(options.startsBefore).getTime();
      return uniqueActivities.filter(a => new Date(a.startsAt).getTime() <= beforeMs);
    }

    return uniqueActivities;
  });
};

export const getActivity = async (contextId: number, id: number, type?: string): Promise<Activity | null> => {
  // Check localStorage cache first
  try {
    const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
    if (itemCache[id]) return itemCache[id];
  } catch { }

  const cacheActivity = (act: Activity) => {
    try {
      const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      itemCache[id] = act;
      localStorage.setItem('d4h_activity_cache', JSON.stringify(itemCache));
    } catch { }
  };

  const dedupeKey = `getActivity_${contextId}_${id}_${type || 'unknown'}`;
  return dedupe(dedupeKey, async () => {
    if (type === 'exercise' || type === 'event' || type === 'incident') {
      const res = await api.get<Activity>(`/team/${contextId}/${type}s/${id}`).catch(() => null);
      if (res?.data && res.data.id) {
        const act: Activity = { ...res.data, type: type as any };
        cacheActivity(act);
        return act;
      }
    }

    let res = await api.get<Activity>(`/team/${contextId}/exercises/${id}`).catch(() => null);
    if (res?.data && res.data.id) {
      const act: Activity = { ...res.data, type: 'exercise' };
      cacheActivity(act);
      return act;
    }

    res = await api.get<Activity>(`/team/${contextId}/events/${id}`).catch(() => null);
    if (res?.data && res.data.id) {
      const act: Activity = { ...res.data, type: 'event' };
      cacheActivity(act);
      return act;
    }

    res = await api.get<Activity>(`/team/${contextId}/incidents/${id}`).catch(() => null);
    if (res?.data && res.data.id) {
      const act: Activity = { ...res.data, type: 'incident' };
      cacheActivity(act);
      return act;
    }

    return null;
  });
};

export const getSynchronousAttendees = (exerciseId: number): Attendee[] | null => {
  try {
    const raw = localStorage.getItem(`d4h_attendees_cache_${exerciseId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && Date.now() - (parsed.timestamp || 0) < ACTIVITIES_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { }
  return null;
};

export const getAttendees = async (contextId: number, exerciseId: number): Promise<Attendee[]> => {
  const syncCached = getSynchronousAttendees(exerciseId);
  if (syncCached) return syncCached;

  const dedupeKey = `getAttendees_${contextId}_${exerciseId}`;
  return dedupe(dedupeKey, async () => {
    const res = await api.get<{ results: Attendee[] }>(`/team/${contextId}/attendance`, {
      params: {
        activity_id: exerciseId,
        size: 200,
      },
    });

    const attending = res.data.results.filter(a =>
      a.status === 'ATTENDING' ||
      a.status === 'attending' ||
      a.status === 'CONFIRMED' ||
      a.status === 'confirmed'
    );

    try {
      safeSetLocalStorageItem(`d4h_attendees_cache_${exerciseId}`, JSON.stringify({
        data: attending,
        timestamp: Date.now(),
      }));
    } catch { }

    return attending;
  });
};

/**
 * Extracts a normalized mission / incident prefix from an activity (e.g. "YTO #10", "2026-LAW-54261680").
 * Strips operational period / day suffixes like "- Day 2", "Op Period 2", "OP2", etc.
/**
 * Strips operational period indicators (e.g. "Day 2", "Op Period 3", "(OP 2)", "- Shift 1")
 * from a reference or title string.
 */
function cleanOpPeriodSuffix(str: string): string {
  return (str || '')
    .replace(/[\s\-_–—,]+(op|operational\s*period|period|day|shift)\s*#?\d+.*$/i, '')
    .replace(/\s*\((op|operational\s*period|period|day|shift)\s*#?\d+.*\)$/i, '')
    .replace(/[\s\-_–—,]+(day\s*\d+|op\s*\d+).*$/i, '')
    .trim();
}

/**
 * Extracts a normalized mission identifier (e.g. "2026-LAW-54261680", "YTO #10", "CA-SNC-001234").
 */
export function extractActivityPrefix(activity: Partial<Activity> | null | undefined): string {
  if (!activity) return '';

  // 1. Check reference field (e.g., "2026-LAW-54261680", "YTO #10", "CA-SNC-001234")
  const ref = (activity.reference || '').trim();
  if (ref) {
    const cleanedRef = cleanOpPeriodSuffix(ref);
    if (cleanedRef && !/^\d{4}$/.test(cleanedRef)) {
      return cleanedRef.toLowerCase();
    }
  }

  // 2. Check title / description
  const title = (activity.referenceDescription || activity.description || '').trim();
  if (title) {
    // Check for State Incident Number pattern (e.g. "2026-LAW-54261680", "CA-SNC-001234", "2025-SAR-12345")
    const incidentNumMatch = title.match(/\b(\d{4}-[A-Z0-9]+-\d+)\b/i) || title.match(/\b([A-Z]{2,4}-[A-Z0-9]{2,4}-\d+)\b/i);
    if (incidentNumMatch) {
      return incidentNumMatch[0].toLowerCase();
    }

    // Check for callout/mission prefix pattern (e.g. "YTO #10", "SAR #5", "YTO-10")
    const calloutMatch = title.match(/\b([A-Z]{2,6}\s*#\s*\d+)\b/i) || title.match(/\b([A-Z]{2,6}-\d+)\b/i);
    if (calloutMatch) {
      return calloutMatch[0].toLowerCase().replace(/\s+/g, ' ');
    }

    // Clean op period suffix
    const baseTitle = cleanOpPeriodSuffix(title);
    if (baseTitle && !/^\d{4}$/.test(baseTitle)) {
      return baseTitle.toLowerCase();
    }
  }

  return '';
}

/**
 * Determines whether two activities belong to the same multi-day/multi-period mission
 * based on matching reference, incident number, or common prefix.
 */
export function areActivitiesSameMission(
  act1: Partial<Activity> | null | undefined,
  act2: Partial<Activity> | null | undefined
): boolean {
  if (!act1 || !act2) return false;
  if (act1.id && act2.id && act1.id === act2.id) return true;

  const title1 = (act1.referenceDescription || act1.description || '').trim().toLowerCase();
  const title2 = (act2.referenceDescription || act2.description || '').trim().toLowerCase();

  // 1. Direct reference equality (ignoring op suffix)
  const ref1 = cleanOpPeriodSuffix(act1.reference || '').toLowerCase();
  const ref2 = cleanOpPeriodSuffix(act2.reference || '').toLowerCase();
  if (ref1 && ref2 && ref1 === ref2 && !/^\d{4}$/.test(ref1)) {
    return true;
  }

  // 2. Incident Number matching (e.g. 2026-LAW-54261680)
  const incNumRegex = /\b(\d{4}-[A-Z0-9]+-\d+)\b/i;
  const inc1 = (act1.reference || '').match(incNumRegex) || title1.match(incNumRegex);
  const inc2 = (act2.reference || '').match(incNumRegex) || title2.match(incNumRegex);
  if (inc1 && inc2 && inc1[1].toLowerCase() === inc2[1].toLowerCase()) {
    return true;
  }

  // 3. Callout Code matching (e.g. "YTO #10", "YTO-10")
  const calloutRegex = /\b([A-Z]{2,6})\s*#?\s*(\d+)\b/i;
  const c1 = (act1.reference || '').match(calloutRegex) || title1.match(calloutRegex);
  const c2 = (act2.reference || '').match(calloutRegex) || title2.match(calloutRegex);
  if (c1 && c2) {
    const code1 = `${c1[1].toLowerCase()}-${c1[2]}`;
    const code2 = `${c2[1].toLowerCase()}-${c2[2]}`;
    if (code1 === code2) {
      return true;
    }
  }

  // 4. Exact cleaned base title match (must be a substantial string, not just generic words or year)
  const base1 = cleanOpPeriodSuffix(act1.referenceDescription || act1.description || '').trim().toLowerCase();
  const base2 = cleanOpPeriodSuffix(act2.referenceDescription || act2.description || '').trim().toLowerCase();
  if (base1 && base2 && base1 === base2 && base1.length >= 8 && !/^\d{4}$/.test(base1)) {
    return true;
  }

  return false;
}

/**
 * Searches for an immediate previous calendar day activity that belongs to the same mission.
 */
export async function findImmediatePreviousDayActivity(
  contextId: number,
  currentActivity: Activity,
  allActivities?: Activity[]
): Promise<Activity | null> {
  if (!currentActivity?.startsAt) return null;
  const currentStart = new Date(currentActivity.startsAt);
  if (isNaN(currentStart.getTime())) return null;

  // 1. Check in passed activities or cached activity list
  let activityList: Activity[] = allActivities || [];
  if (activityList.length === 0) {
    try {
      const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      activityList = Object.values(itemCache);
    } catch { }
  }

  // Helper to find match in candidate list
  const findCandidate = (list: Activity[]): Activity | null => {
    for (const act of list) {
      if (act.id === currentActivity.id) continue;
      if (!act.startsAt) continue;
      const actStart = new Date(act.startsAt);
      if (isNaN(actStart.getTime())) continue;

      const dayDiff = differenceInCalendarDays(currentStart, actStart);
      // Immediate previous calendar day
      if (dayDiff === 1 && areActivitiesSameMission(currentActivity, act)) {
        return act;
      }
    }
    return null;
  };

  const cachedCandidate = findCandidate(activityList);
  if (cachedCandidate) return cachedCandidate;

  // Fetch activities from 4 days ago up to current start
  try {
    const fourDaysAgo = subDays(currentStart, 4).toISOString();
    const fetched = await getActivities(contextId, {
      startsAfter: fourDaysAgo,
      startsBefore: currentActivity.startsAt,
    });
    return findCandidate(fetched);
  } catch (err) {
    console.warn('[D4H Multi-Op] Failed to search for previous day activity:', err);
    return null;
  }
}

/**
 * Searches for an immediate next calendar day activity that belongs to the same mission.
 */
export async function findImmediateNextDayActivity(
  contextId: number,
  currentActivity: Activity,
  allActivities?: Activity[]
): Promise<Activity | null> {
  if (!currentActivity?.startsAt) return null;
  const currentStart = new Date(currentActivity.startsAt);
  if (isNaN(currentStart.getTime())) return null;

  // 1. Check in passed activities or cached activity list
  let activityList: Activity[] = allActivities || [];
  if (activityList.length === 0) {
    try {
      const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
      activityList = Object.values(itemCache);
    } catch { }
  }

  // Helper to find match in candidate list
  const findCandidate = (list: Activity[]): Activity | null => {
    for (const act of list) {
      if (act.id === currentActivity.id) continue;
      if (!act.startsAt) continue;
      const actStart = new Date(act.startsAt);
      if (isNaN(actStart.getTime())) continue;

      const dayDiff = differenceInCalendarDays(actStart, currentStart);
      // Immediate next calendar day
      if (dayDiff === 1 && areActivitiesSameMission(currentActivity, act)) {
        return act;
      }
    }
    return null;
  };

  const cachedCandidate = findCandidate(activityList);
  if (cachedCandidate) return cachedCandidate;

  // Fetch activities from current start up to 4 days forward
  try {
    const fourDaysLater = addDays(currentStart, 4).toISOString();
    const fetched = await getActivities(contextId, {
      startsAfter: currentActivity.startsAt,
      startsBefore: fourDaysLater,
    });
    return findCandidate(fetched);
  } catch (err) {
    console.warn('[D4H Multi-Op] Failed to search for next day activity:', err);
    return null;
  }
}

export interface AdjacentOpPeriodsResult {
  yesterdayActivity: Activity | null;
  tomorrowActivity: Activity | null;
  hasYesterdayOp: boolean;
  hasTomorrowOp: boolean;
  isMultiDaySpanning: boolean;
}

export async function getAdjacentOpPeriods(
  contextId: number,
  currentActivity: Activity | null
): Promise<AdjacentOpPeriodsResult> {
  const result: AdjacentOpPeriodsResult = {
    yesterdayActivity: null,
    tomorrowActivity: null,
    hasYesterdayOp: false,
    hasTomorrowOp: false,
    isMultiDaySpanning: false,
  };

  if (!contextId || !currentActivity) return result;

  // Check if current activity itself spans multiple calendar days
  if (currentActivity.startsAt) {
    const sDate = new Date(currentActivity.startsAt);
    const eDate = currentActivity.endsAt ? new Date(currentActivity.endsAt) : sDate;
    if (!isNaN(sDate.getTime()) && !isNaN(eDate.getTime()) && !isSameDay(sDate, eDate)) {
      result.isMultiDaySpanning = true;
    }
  }

  try {
    const [prevAct, nextAct] = await Promise.all([
      findImmediatePreviousDayActivity(contextId, currentActivity),
      findImmediateNextDayActivity(contextId, currentActivity),
    ]);

    if (prevAct) {
      result.yesterdayActivity = prevAct;
      result.hasYesterdayOp = true;
    }
    if (nextAct) {
      result.tomorrowActivity = nextAct;
      result.hasTomorrowOp = true;
    }
  } catch (err) {
    console.warn('[D4H Multi-Op] Failed to fetch adjacent op periods:', err);
  }

  return result;
}

export interface PreviousOpPeriodResult {
  previousActivity: Activity | null;
  previousMemberIds: Set<number>;
  previousAttendees: Attendee[];
}

/**
 * Pre-loads the immediate previous day's responding personnel for an activity.
 * Supports both:
 * 1. Multiple distinct D4H activities with matching incident prefix/reference on consecutive days.
 * 2. Single multi-day D4H activity where attendees are scheduled on consecutive operational dates.
 * 
 * Automatically persists previous activity and attendees into localStorage.
 */
export async function getPreviousOpPeriodAttendees(
  contextId: number,
  currentActivity: Activity | null,
  currentAttendees?: Attendee[]
): Promise<PreviousOpPeriodResult> {
  const result: PreviousOpPeriodResult = {
    previousActivity: null,
    previousMemberIds: new Set<number>(),
    previousAttendees: [],
  };

  if (!contextId || !currentActivity) return result;

  const currentStart = currentActivity.startsAt ? new Date(currentActivity.startsAt) : null;

  // 1. Check for single multi-day / multi-period activity shifts in currentAttendees
  if (currentAttendees && currentAttendees.length > 0 && currentStart && !isNaN(currentStart.getTime())) {
    currentAttendees.forEach((att) => {
      const memberId = att.member?.id;
      if (!memberId) return;

      if (att.startsAt) {
        const attStart = new Date(att.startsAt);
        if (!isNaN(attStart.getTime())) {
          const dayDiff = differenceInCalendarDays(currentStart, attStart);
          if (dayDiff === 1) {
            result.previousMemberIds.add(memberId);
            result.previousAttendees.push(att);
          }
        }
      }
    });
  }

  // 2. Check for separate D4H activity on the immediate previous calendar day
  try {
    const prevAct = await findImmediatePreviousDayActivity(contextId, currentActivity);
    if (prevAct) {
      result.previousActivity = prevAct;

      // Pre-load immediate previous activity's attendees
      const prevAttendees = await getAttendees(contextId, prevAct.id);
      result.previousAttendees = [...result.previousAttendees, ...prevAttendees];

      prevAttendees.forEach((att) => {
        const mid = att.member?.id;
        if (mid) {
          result.previousMemberIds.add(mid);
        }
      });

      // Pre-fetch missing member profiles in background to populate caches
      const memberIdsToFetch = Array.from(result.previousMemberIds);
      if (memberIdsToFetch.length > 0) {
        getMemberDetails(contextId, memberIdsToFetch).catch(() => { });
      }

      // Persist previous activity to activity cache
      try {
        const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
        itemCache[prevAct.id] = prevAct;
        safeSetLocalStorageItem('d4h_activity_cache', JSON.stringify(itemCache));
      } catch { }
    }
  } catch (err) {
    console.warn('[D4H Multi-Op] Failed to load previous op period attendees:', err);
  }

  return result;
}

export const getSynchronousMember = (contextId: number, memberId: number): Member | null => {
  if (!contextId || !memberId) return null;
  const cacheKey = `d4h_members_cache_${contextId}`;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed[memberId]?.data) {
        return parsed[memberId].data;
      }
    }
  } catch { }
  return null;
};

export const getMemberDetails = async (contextId: number, memberIds: number[]): Promise<Member[]> => {
  if (memberIds.length === 0) return [];

  const cacheKey = `d4h_members_cache_${contextId}`;
  let memberCache: Record<number, { data: Member; cachedAt: number }> = {};
  try {
    memberCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  } catch { }

  const now = Date.now();
  const missingIds: number[] = [];

  memberIds.forEach(id => {
    const cached = memberCache[id];
    if (!cached || now - cached.cachedAt >= CACHE_TTL_MS || !cached.data) {
      missingIds.push(id);
    }
  });

  if (missingIds.length === 0) {
    return memberIds.map(id => memberCache[id]?.data).filter((m): m is Member => !!m);
  }

  const dedupeKey = `getMemberDetails_${contextId}_${missingIds.sort().join(',')}`;
  return dedupe(dedupeKey, async () => {
    try {
      // 1. Fetch team members in bulk (up to 250 per page)
      let page = 1;
      let morePages = true;
      while (morePages && page <= 3) {
        const res = await api.get<{ results: Member[]; count?: number }>(`/team/${contextId}/members`, {
          params: { size: 250, page },
        }).catch((e) => {
          console.warn(`[D4H API] Failed to fetch /team/${contextId}/members page ${page}:`, e);
          return { data: { results: [], count: 0 } };
        });

        const fetchedMembers = res.data.results || [];
        fetchedMembers.forEach(m => {
          if (m.id) {
            memberCache[m.id] = { data: m, cachedAt: Date.now() };
          }
        });

        // If we found all missing IDs or reached end of list, stop pagination
        const stillMissing = missingIds.some(id => !memberCache[id]?.data);
        if (!stillMissing || fetchedMembers.length < 250) {
          morePages = false;
        } else {
          page++;
        }
      }

      // 2. For any remaining missing member IDs, fetch them individually as fallback
      const remainingMissingIds = missingIds.filter(id => !memberCache[id]?.data);
      if (remainingMissingIds.length > 0) {
        console.info(`[D4H Member Details] Fetching ${remainingMissingIds.length} missing members individually:`, remainingMissingIds);
        await Promise.allSettled(
          remainingMissingIds.map(async (id) => {
            try {
              const res = await api.get<Member>(`/team/${contextId}/members/${id}`);
              if (res.data && res.data.id) {
                memberCache[res.data.id] = { data: res.data, cachedAt: Date.now() };
              }
            } catch (err) {
              console.warn(`[D4H Member Details] Could not fetch member #${id}:`, err);
            }
          })
        );
      }

      try {
        safeSetLocalStorageItem(cacheKey, JSON.stringify(memberCache));
      } catch { }
    } catch (e) {
      console.error('[D4H Member Details] Error fetching member details:', e);
    }

    const resolvedResults = memberIds.map(id => memberCache[id]?.data).filter((m): m is Member => !!m);
    console.log(`[D4H Member Details] Requested ${memberIds.length} members, resolved ${resolvedResults.length}:`, resolvedResults);
    return resolvedResults;
  });
};

const memberImageMemoryCache = new Map<number, string | null>();
const AVATAR_CACHE_PREFIX = 'd4h_avatar_cache_';
const AVATAR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (per user requirement)

function downscaleBlobToDataUrl(blob: Blob, targetSize = 64): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(objUrl);
          return;
        }
        const minDim = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - minDim) / 2;
        const sy = (img.naturalHeight - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        resolve(dataUrl);
      } catch {
        resolve(objUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      resolve('');
    };
    img.src = objUrl;
  });
}

export const getSynchronousMemberImageUrl = (contextId: number, memberId: number): string | null => {
  if (!contextId || !memberId) return null;
  if (memberImageMemoryCache.has(memberId)) {
    return memberImageMemoryCache.get(memberId) || null;
  }
  const cacheKey = `${AVATAR_CACHE_PREFIX}${contextId}_${memberId}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.timestamp === 'number' && Date.now() - parsed.timestamp < AVATAR_CACHE_TTL_MS) {
        memberImageMemoryCache.set(memberId, parsed.data);
        return parsed.data;
      }
    }
  } catch { }
  return null;
};

export const getMemberImageUrl = async (contextId: number, memberId: number): Promise<string | null> => {
  if (!contextId || !memberId) return null;

  // 1. Check synchronous cache first
  const syncCached = getSynchronousMemberImageUrl(contextId, memberId);
  if (syncCached) return syncCached;
  if (memberImageMemoryCache.has(memberId) && memberImageMemoryCache.get(memberId) === null) {
    return null; // Known negative cache
  }

  const cacheKey = `${AVATAR_CACHE_PREFIX}${contextId}_${memberId}`;

  return dedupe(`getMemberImageUrl_${contextId}_${memberId}`, async () => {
    try {
      const res = await api.get(`/team/${contextId}/members/${memberId}/image`, {
        responseType: 'blob',
      });
      if (res.status === 200 && res.data && res.data.size > 0) {
        const compressedDataUrl = await downscaleBlobToDataUrl(res.data, 64);
        if (compressedDataUrl) {
          memberImageMemoryCache.set(memberId, compressedDataUrl);
          safeSetLocalStorageItem(cacheKey, JSON.stringify({ data: compressedDataUrl, timestamp: Date.now() }));
          return compressedDataUrl;
        }
      }
    } catch {
      // Negative caching for 404 / no image to prevent repeated network requests
      memberImageMemoryCache.set(memberId, null);
      safeSetLocalStorageItem(cacheKey, JSON.stringify({ data: null, timestamp: Date.now() }));
    }
    return null;
  });
};

export interface MemberQualificationAward {
  id: number;
  member: { id: number; resourceType: string };
  qualification: { id: number; title?: string; resourceType: string };
  awardedAt?: string;
  expiresAt?: string | null;
  endsAt?: string | null;
  startsAt?: string | null;
  resourceType: string;
}

export interface MemberQualificationsResult {
  medicalMap: Record<number, string>;
  technicalMap: Record<number, string>;
}

/**
 * Fetches qualification awards for the given members with a 30-minute cache TTL.
 */
export const getMemberQualifications = async (
  contextId: number,
  memberIds: number[]
): Promise<MemberQualificationsResult> => {
  if (memberIds.length === 0) return { medicalMap: {}, technicalMap: {} };

  const cacheKey = `d4h_quals_cache_${contextId}`;

  // Check 30-minute storage cache
  try {
    const saved = localStorage.getItem(cacheKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.cachedAt && Date.now() - parsed.cachedAt < CACHE_TTL_MS && parsed.medicalMap && parsed.technicalMap) {
        return {
          medicalMap: parsed.medicalMap,
          technicalMap: parsed.technicalMap,
        };
      }
    }
  } catch { }

  const dedupeKey = `getMemberQualifications_${contextId}`;
  return dedupe(dedupeKey, async () => {
    const medicalMap: Record<number, string> = {};
    const technicalMap: Record<number, string> = {};
    const now = new Date().toISOString();

    try {
      // 1. Fetch qualification definitions
      const defsRes = await api.get<{ results: { id: number; title: string; deprecatedBundle?: string }[] }>(
        `/team/${contextId}/member-qualifications`,
        { params: { size: 250 } }
      ).catch(() => ({ data: { results: [] } }));

      const qualDefMap: Record<number, { title: string; isMedical: boolean; isIgnored: boolean }> = {};
      (defsRes.data.results ?? []).forEach((q) => {
        if (q.id && q.title) {
          const isMed = q.deprecatedBundle === 'Medical' || /^(CPR|MED|CISM|WFA|WFR|EMT|BLS|First Aid)/i.test(q.title);
          const isIgnored = q.deprecatedBundle === 'Clerical' || /^(Candidate Fees|Member Dues|Code of Conduct|Youth Protection)/i.test(q.title);
          qualDefMap[q.id] = { title: q.title, isMedical: isMed, isIgnored };
        }
      });

      // 2. Paginate through all awards
      let page = 1;
      const PAGE_SIZE = 250;

      while (true) {
        const res = await api.get<{ results: MemberQualificationAward[]; count?: number }>(
          `/team/${contextId}/member-qualification-awards`,
          { params: { size: PAGE_SIZE, page } }
        );

        const awards = res.data.results ?? [];
        if (awards.length === 0) break;

        awards.forEach((award) => {
          const memberId = award.member?.id;
          if (!memberId) return;
          const expiration = award.endsAt || award.expiresAt;
          if (expiration && expiration < now) return;

          const qualId = award.qualification?.id;
          const def = qualId ? qualDefMap[qualId] : undefined;
          const title = def?.title || award.qualification?.title;
          if (!title || def?.isIgnored) return;

          const isMed = def?.isMedical ?? (/^(CPR|MED|CISM|WFA|WFR|EMT|BLS|First Aid)/i.test(title));
          const targetMap = isMed ? medicalMap : technicalMap;

          const currentQuals = targetMap[memberId] ? targetMap[memberId].split(', ') : [];
          if (!currentQuals.includes(title)) {
            targetMap[memberId] = targetMap[memberId] ? `${targetMap[memberId]}, ${title}` : title;
          }
        });

        if (awards.length < PAGE_SIZE) break;
        page++;
      }

      // Save to 30-minute cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          medicalMap,
          technicalMap,
          cachedAt: Date.now(),
        }));
      } catch { }
    } catch (e: unknown) {
      console.error('[Quals] API call failed:', e);
    }

    return { medicalMap, technicalMap };
  });
};

export const getUserAttendanceForActivity = async (
  contextId: number,
  activityId: number,
  memberId: number
): Promise<Attendee | null> => {
  const dedupeKey = `getUserAttendance_${contextId}_${activityId}_${memberId}`;
  return dedupe(dedupeKey, async () => {
    try {
      const res = await api.get<{ results: Attendee[] }>(`/team/${contextId}/attendance`, {
        params: {
          activity_id: activityId,
          member_id: memberId,
          size: 1,
        },
      });
      return res.data.results?.[0] || null;
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn('[D4H API] Failed to fetch user attendance for activity:', e);
      }
      return null;
    }
  });
};

export const updateUserAttendance = async (
  contextId: number,
  attendanceId: number,
  status: 'ATTENDING' | 'ABSENT' | 'REQUESTED'
): Promise<Attendee> => {
  const res = await api.patch<Attendee>(`/team/${contextId}/attendance/${attendanceId}`, {
    status,
  });
  userAttendanceCache.clear();
  return res.data;
};

export const createUserAttendance = async (
  contextId: number,
  data: {
    activityId: number;
    memberId: number;
    startsAt: string;
    endsAt: string;
    status: 'ATTENDING' | 'ABSENT' | 'REQUESTED';
  }
): Promise<Attendee> => {
  const res = await api.post<Attendee>(`/team/${contextId}/attendance`, {
    activityId: data.activityId,
    memberId: data.memberId,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    status: data.status,
  });
  userAttendanceCache.clear();
  return res.data;
};

export interface UserPermissions {
  canUpdateOwnAttendance: boolean;
  canCreateAttendance: boolean;
  canUpdateAllAttendance: boolean;
  canUpdateExercise: boolean;
  canUpdateIncident: boolean;
  canUpdateEvent: boolean;
  memberId: number | null;
}

const permissionsMemoryCache = new Map<number, { perms: UserPermissions; cachedAt: number }>();
const PERMISSIONS_TTL_MS = 60 * 60 * 1000; // 60 minutes TTL

export const getCurrentUserPermissions = async (
  contextId?: number | string
): Promise<UserPermissions> => {
  const targetContextId = contextId ? Number(contextId) : null;
  if (targetContextId) {
    const cached = permissionsMemoryCache.get(targetContextId);
    if (cached && Date.now() - cached.cachedAt < PERMISSIONS_TTL_MS) {
      return cached.perms;
    }
  }

  const dedupeKey = `getCurrentUserPermissions_${targetContextId || 'default'}`;
  return dedupe(dedupeKey, async () => {
    try {
      const res = await api.get<WhoAmIResponse>('/whoami');
      const member = targetContextId
        ? res.data.members?.find((m) => m.owner.id === targetContextId)
        : res.data.members?.find((m) => m.owner.resourceType === 'Team') || res.data.members?.[0];

      const perms = member?.permissions as Record<string, any> | undefined;
      const attPerms = perms?.ActivityAttendance;
      const incPerms = perms?.Incident;
      const exPerms = perms?.Exercise;
      const evPerms = perms?.Event;

      const result: UserPermissions = {
        canUpdateOwnAttendance: Boolean(attPerms?.UPDATEOWN),
        canCreateAttendance: Boolean(attPerms?.CREATE),
        canUpdateAllAttendance: Boolean(attPerms?.UPDATE),
        canUpdateExercise: Boolean(exPerms?.UPDATE),
        canUpdateIncident: Boolean(incPerms?.UPDATE),
        canUpdateEvent: Boolean(evPerms?.UPDATE),
        memberId: member?.id || null,
      };

      if (targetContextId) {
        permissionsMemoryCache.set(targetContextId, { perms: result, cachedAt: Date.now() });
      }

      return result;
    } catch (e) {
      return {
        canUpdateOwnAttendance: false,
        canCreateAttendance: false,
        canUpdateAllAttendance: false,
        canUpdateExercise: false,
        canUpdateIncident: false,
        canUpdateEvent: false,
        memberId: null,
      };
    }
  });
};

export interface CanUserRespondParams {
  isLocal?: boolean;
  isPast?: boolean;
  contextId?: number | null;
  activityId?: number | null;
  activityType?: string;
  userPermissions?: UserPermissions | null;
  userAttendance?: Attendee | null;
  attendees?: Attendee[];
  effectiveMemberId?: number | null;
}

export function canUserRespondToActivity(params: CanUserRespondParams): boolean {
  const {
    isLocal,
    isPast,
    contextId,
    activityId,
    activityType,
    userPermissions,
    userAttendance,
    attendees,
    effectiveMemberId,
  } = params;

  if (isLocal || isPast || !contextId || !activityId || !userPermissions) return false;

  const actType = (activityType || 'exercise').toLowerCase();
  const hasActivityAdminPermission =
    actType === 'incident'
      ? userPermissions.canUpdateIncident
      : actType === 'event'
      ? userPermissions.canUpdateEvent
      : userPermissions.canUpdateExercise;

  const hasCreatePermission =
    userPermissions.canCreateAttendance || userPermissions.canUpdateAllAttendance || hasActivityAdminPermission;

  if (hasCreatePermission) return true;

  const hasExistingAttendanceRecord = Boolean(
    userAttendance?.id ||
    (attendees && effectiveMemberId && attendees.some((a) => a.member?.id === effectiveMemberId && a.id))
  );

  return userPermissions.canUpdateOwnAttendance && hasExistingAttendanceRecord;
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const getSynchronousActivityAttachments = (activityId: number | string): ActivityAttachment[] | null => {
  try {
    const raw = localStorage.getItem(`d4h_activity_attachments_${activityId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.data) && Date.now() - (parsed.timestamp || 0) < ACTIVITIES_CACHE_TTL_MS) {
        return parsed.data;
      }
    }
  } catch { }
  return null;
};

export const getActivityAttachments = async (
  contextId: number,
  activityId: number | string,
  _activityType?: string
): Promise<ActivityAttachment[]> => {
  const sync = getSynchronousActivityAttachments(activityId);
  if (sync) return sync;

  const dedupeKey = `getActivityAttachments_${contextId}_${activityId}`;
  return dedupe(dedupeKey, async () => {
    try {
      // D4H API v3: Documents attached to exercises/events/incidents are queried via target_resource_id
      const res = await api.get<{ results?: ActivityAttachment[]; data?: ActivityAttachment[] } | ActivityAttachment[]>(
        `/team/${contextId}/documents`,
        { params: { target_resource_id: activityId, size: 250 } }
      ).catch((e) => {
        console.warn(`[D4H API] Failed to fetch documents for activity ${activityId}:`, e);
        return null;
      });

      let attachments: ActivityAttachment[] = [];
      if (res?.data) {
        if (Array.isArray(res.data)) {
          attachments = res.data;
        } else if (Array.isArray((res.data as any).results)) {
          attachments = (res.data as any).results;
        } else if (Array.isArray((res.data as any).data)) {
          attachments = (res.data as any).data;
        }
      }

      // If results empty, check embedded attachments on activity cache
      if (attachments.length === 0) {
        try {
          const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
          const act = itemCache[activityId];
          if (act && Array.isArray(act.attachments) && act.attachments.length > 0) {
            attachments = act.attachments;
          } else if (act && Array.isArray(act.documents) && act.documents.length > 0) {
            attachments = act.documents;
          }
        } catch { }
      }

      // Cache to localStorage (15m TTL)
      try {
        safeSetLocalStorageItem(
          `d4h_activity_attachments_${activityId}`,
          JSON.stringify({ data: attachments, timestamp: Date.now() })
        );
      } catch { }

      return attachments;
    } catch (e) {
      console.warn(`[D4H API] Failed to fetch attachments for activity ${activityId}:`, e);
      return [];
    }
  });
};

export const downloadActivityAttachment = async (
  contextId: number,
  _activityId: number | string,
  attachment: ActivityAttachment,
  _activityType?: string
): Promise<void> => {
  const ext = attachment.fileExt ? `.${attachment.fileExt.replace(/^\./, '')}` : '';
  let filename = attachment.filename || attachment.name || attachment.title || `attachment_${attachment.id}`;
  if (ext && !filename.toLowerCase().endsWith(ext.toLowerCase())) {
    filename = `${filename}${ext}`;
  }

  const targetUrl =
    attachment.downloadUrl ||
    attachment.url ||
    `/team/${contextId}/documents/${attachment.id}/download`;

  try {
    const res = await api.get(targetUrl, { responseType: 'blob' });
    const mime = attachment.fileType || attachment.mimeType || attachment.contentType || 'application/octet-stream';
    const blob = new Blob([res.data], { type: mime });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (e) {
    console.warn('[D4H API] Blob download failed, attempting window.open fallback:', e);
    if (attachment.url && (attachment.url.startsWith('http://') || attachment.url.startsWith('https://'))) {
      window.open(attachment.url, '_blank', 'noopener,noreferrer');
    }
  }
};

const attachmentBlobCache = new Map<number, string>();

export const getActivityAttachmentPreviewBlobUrl = async (
  contextId: number,
  attachmentId: number,
  mimeType?: string
): Promise<string | null> => {
  if (attachmentBlobCache.has(attachmentId)) {
    return attachmentBlobCache.get(attachmentId)!;
  }

  try {
    const res = await api.get(`/team/${contextId}/documents/${attachmentId}/download`, {
      params: { size: 'PREVIEW' },
      responseType: 'blob',
    });
    if (res.data) {
      const blob = new Blob([res.data], { type: mimeType || 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      attachmentBlobCache.set(attachmentId, url);
      return url;
    }
  } catch {
    try {
      const res = await api.get(`/team/${contextId}/documents/${attachmentId}/download`, {
        responseType: 'blob',
      });
      if (res.data) {
        const blob = new Blob([res.data], { type: mimeType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        attachmentBlobCache.set(attachmentId, url);
        return url;
      }
    } catch {}
  }
  return null;
};



