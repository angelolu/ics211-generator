import axios from 'axios';

const BASE_URL = 'https://api.team-manager.us.d4h.com/v3';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes for members and qualifications
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

      if (!window.location.pathname.includes('/login')) {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const loginUrl = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + 'login';
        window.location.href = loginUrl;
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

export function formatActivityLocation(activity?: Partial<Activity>): string {
  if (!activity) return '';

  const street = activity.address?.street?.trim();
  const town = activity.address?.town?.trim();
  const region = activity.address?.region?.trim();

  const addressParts = [street, town].filter(Boolean);
  if (addressParts.length > 0) {
    return addressParts.join(', ');
  }

  if (region) {
    return region;
  }

  if (
    activity.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [lng, lat] = activity.location.coordinates;
    if (lat !== 0 || lng !== 0) {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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

export const getMemberDetails = async (contextId: number, memberIds: number[]): Promise<Member[]> => {
  if (memberIds.length === 0) return [];

  const cacheKey = `d4h_members_cache_${contextId}`;
  let memberCache: Record<number, { data: Member; cachedAt: number }> = {};
  try {
    memberCache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  } catch { }

  const now = Date.now();
  const missingIds: number[] = [];
  const results: Member[] = [];

  memberIds.forEach(id => {
    const cached = memberCache[id];
    if (cached && now - cached.cachedAt < CACHE_TTL_MS && cached.data) {
      results.push(cached.data);
    } else {
      missingIds.push(id);
    }
  });

  if (missingIds.length === 0) {
    return results;
  }

  const dedupeKey = `getMemberDetails_${contextId}_${missingIds.sort().join(',')}`;
  return dedupe(dedupeKey, async () => {
    try {
      const res = await api.get<{ results: Member[] }>(`/team/${contextId}/members`, {
        params: {
          id: missingIds,
          size: missingIds.length,
        },
      });

      const fetchedMembers = res.data.results || [];
      fetchedMembers.forEach(m => {
        if (m.id) {
          memberCache[m.id] = { data: m, cachedAt: Date.now() };
          results.push(m);
        }
      });

      try {
        localStorage.setItem(cacheKey, JSON.stringify(memberCache));
      } catch { }
    } catch (e) {
      console.error('Error fetching member details:', e);
    }

    return results;
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
