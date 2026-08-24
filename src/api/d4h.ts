import axios from 'axios';
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
const api = axios.create({
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

export function formatActivityLocation(activity?: Partial<Activity>): string {
  if (!activity) return '';

  const streetAddress = getActivityStreetAddress(activity);
  if (streetAddress) {
    return streetAddress;
  }

  // If no full street address with house number, use GPS coordinates if available
  if (
    activity.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [lng, lat] = activity.location.coordinates;
    if (lat !== 0 || lng !== 0) {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  const town = activity.address?.town?.trim();
  const region = activity.address?.region?.trim();

  if (town) {
    if (region && !town.toLowerCase().includes(region.toLowerCase())) {
      return `${town}, ${region}`;
    }
    return town;
  }

  if (region) {
    return region;
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

  // Clean up any stale localStorage activity list caches from previous sessions
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('d4h_activities_cache_')) {
        localStorage.removeItem(k);
      }
    }
  } catch { }

  // Check in-memory cache unless forceRefresh is requested
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

    // Store in in-memory cache for SPA view switching
    activityListCache.set(cacheKey, { results: uniqueActivities, cachedAt: Date.now() });

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

  const dedupeKey = `getActivity_${contextId}_${id}_${type || 'unknown'}`;
  return dedupe(dedupeKey, async () => {
    if (type === 'exercise' || type === 'event' || type === 'incident') {
      const res = await api.get<Activity>(`/team/${contextId}/${type}s/${id}`).catch(() => null);
      if (res?.data && res.data.id) {
        const act = { ...res.data, type: type as any };
        try {
          const itemCache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
          itemCache[id] = act;
          localStorage.setItem('d4h_activity_cache', JSON.stringify(itemCache));
        } catch { }
        return act;
      }
    }

    let res = await api.get<Activity>(`/team/${contextId}/exercises/${id}`).catch(() => null);
    if (res?.data && res.data.id) return { ...res.data, type: 'exercise' as const };

    res = await api.get<Activity>(`/team/${contextId}/events/${id}`).catch(() => null);
    if (res?.data && res.data.id) return { ...res.data, type: 'event' as const };

    res = await api.get<Activity>(`/team/${contextId}/incidents/${id}`).catch(() => null);
    if (res?.data && res.data.id) return { ...res.data, type: 'incident' as const };

    return null;
  });
};

export const getAttendees = async (contextId: number, exerciseId: number): Promise<Attendee[]> => {
  const dedupeKey = `getAttendees_${contextId}_${exerciseId}`;
  return dedupe(dedupeKey, async () => {
    const res = await api.get<{ results: Attendee[] }>(`/team/${contextId}/attendance`, {
      params: {
        activity_id: exerciseId,
        size: 200,
      },
    });

    return res.data.results.filter(a =>
      a.status === 'ATTENDING' ||
      a.status === 'attending' ||
      a.status === 'CONFIRMED' ||
      a.status === 'confirmed'
    );
  });
};

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

export const getCurrentUserPermissions = async (
  contextId?: number | string
): Promise<UserPermissions> => {
  try {
    const res = await api.get<WhoAmIResponse>('/whoami');
    const targetContextId = contextId ? Number(contextId) : null;
    const member = targetContextId
      ? res.data.members?.find((m) => m.owner.id === targetContextId)
      : res.data.members?.find((m) => m.owner.resourceType === 'Team') || res.data.members?.[0];

    const perms = member?.permissions as Record<string, any> | undefined;
    const attPerms = perms?.ActivityAttendance;
    const incPerms = perms?.Incident;
    const exPerms = perms?.Exercise;
    const evPerms = perms?.Event;

    return {
      canUpdateOwnAttendance: Boolean(attPerms?.UPDATEOWN),
      canCreateAttendance: Boolean(attPerms?.CREATE),
      canUpdateAllAttendance: Boolean(attPerms?.UPDATE),
      canUpdateExercise: Boolean(exPerms?.UPDATE),
      canUpdateIncident: Boolean(incPerms?.UPDATE),
      canUpdateEvent: Boolean(evPerms?.UPDATE),
      memberId: member?.id || null,
    };
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
};


