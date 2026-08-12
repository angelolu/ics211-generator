import axios from 'axios';

const BASE_URL = 'https://api.team-manager.us.d4h.com/v3';

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
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('d4h_token');
      localStorage.removeItem('d4h_context_id');
      localStorage.removeItem('d4h_team_title');

      if (!window.location.pathname.includes('/login')) {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const loginUrl = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + 'login';
        window.location.href = loginUrl;
      }
    }
    return Promise.reject(error);
  }
);

export interface WhoAmIResponse {
  members: {
    owner: {
      id: number;
      resourceType: string;
      title: string;
    };
    name: string;
  }[];
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
}

// Full member info
export interface Member {
  id: number;
  name: string;
  position?: string;
  mobile?: { phone: string };
  home?: { phone: string };
  work?: { phone: string };
  pager?: { phone: string };
}

export const verifyTokenAndGetContext = async (): Promise<{ contextId: number; title: string }> => {
  const res = await api.get<WhoAmIResponse>('/whoami');
  // Find the team context
  const member = res.data.members.find((m) => m.owner.resourceType === 'Team');
  if (!member) {
    throw new Error("No Team context found for this token.");
  }
  return { contextId: member.owner.id, title: member.owner.title };
};

export const getActivities = async (
  contextId: number,
  options?: { startsAfter?: string; startsBefore?: string }
): Promise<Activity[]> => {
  let starts_after: string;
  if (options?.startsAfter) {
    starts_after = options.startsAfter;
  } else {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    starts_after = oneWeekAgo.toISOString();
  }

  const params: Record<string, any> = {
    starts_after,
    sort: 'startsAt',
    order: 'asc',
    size: 250,
  };

  const [exercisesRes, eventsRes, incidentsRes] = await Promise.all([
    api.get<{ results: Activity[] }>(`/team/${contextId}/exercises`, { params }).catch(() => ({ data: { results: [] } })),
    api.get<{ results: Activity[] }>(`/team/${contextId}/events`, { params }).catch(() => ({ data: { results: [] } })),
    api.get<{ results: Activity[] }>(`/team/${contextId}/incidents`, { params }).catch(() => ({ data: { results: [] } })),
  ]);

  const exercises = exercisesRes.data.results.map(r => ({ ...r, type: 'exercise' as const }));
  const events = eventsRes.data.results.map(r => ({ ...r, type: 'event' as const }));
  const incidents = incidentsRes.data.results.map(r => ({ ...r, type: 'incident' as const }));

  const allActivities = [...exercises, ...events, ...incidents];
  
  // Cache fetched activities so we don't have to refetch them if they are edited in the future
  try {
    const cache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
    allActivities.forEach(a => { cache[a.id] = a; });
    localStorage.setItem('d4h_activity_cache', JSON.stringify(cache));
  } catch (e) {
    console.error('Failed to update activity cache', e);
  }

  // Find activities from any time period that have local edits
  const editedActivities: Activity[] = [];
  try {
    const cache = JSON.parse(localStorage.getItem('d4h_activity_cache') || '{}');
    const missingIdsToFetch: number[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('d4h_form_') && !key.startsWith('d4h_form_local_') && !key.startsWith('d4h_form_type_')) {
        const idStr = key.replace('d4h_form_', '');
        const id = parseInt(idStr, 10);
        if (isNaN(id)) continue;
        
        // Already in fetched list?
        if (allActivities.some(a => a.id === id)) continue;

        const savedData = localStorage.getItem(key);
        if (savedData) {
          const formState = JSON.parse(savedData);
          type CellLocallyEdited = { isEditedLocally?: boolean };
          type RowLocallyEdited = { cells?: Record<string, CellLocallyEdited>; isDeleted?: boolean };
          const hasLocalChanges = 
            (formState.headers && Object.values(formState.headers as Record<string, CellLocallyEdited>).some(c => c.isEditedLocally)) ||
            (formState.rows && (formState.rows as RowLocallyEdited[]).some(r => (r.cells && Object.values(r.cells).some(c => c.isEditedLocally)) || r.isDeleted));
            
          if (hasLocalChanges) {
            if (cache[id]) {
              editedActivities.push(cache[id]);
            } else {
              missingIdsToFetch.push(id);
            }
          }
        }
      }
    }
    
    // Fetch missing ones individually
    if (missingIdsToFetch.length > 0) {
      const fetchPromises = missingIdsToFetch.map(async (id) => {
        // We don't know the type, so try exercise first, then event, then incident
        let res = await api.get<Activity>(`/team/${contextId}/exercises/${id}`).catch(() => null);
        if (res?.data && res.data.id) return { ...res.data, type: 'exercise' as const };
        
        res = await api.get<Activity>(`/team/${contextId}/events/${id}`).catch(() => null);
        if (res?.data && res.data.id) return { ...res.data, type: 'event' as const };
        
        res = await api.get<Activity>(`/team/${contextId}/incidents/${id}`).catch(() => null);
        if (res?.data && res.data.id) return { ...res.data, type: 'incident' as const };
        
        return null;
      });
      
      const missingFetched = await Promise.all(fetchPromises);
      missingFetched.forEach(act => {
        if (act) {
          editedActivities.push(act as Activity);
          cache[act.id] = act;
        }
      });
      localStorage.setItem('d4h_activity_cache', JSON.stringify(cache));
    }
  } catch (e) {
    console.error('Error finding edited activities', e);
  }

  let finalActivities = [...allActivities, ...editedActivities];

  if (options?.startsAfter || options?.startsBefore) {
    const afterMs = options.startsAfter ? new Date(options.startsAfter).getTime() : 0;
    const beforeMs = options.startsBefore ? new Date(options.startsBefore).getTime() : Infinity;
    finalActivities = finalActivities.filter((a) => {
      const t = new Date(a.startsAt).getTime();
      return t >= afterMs && t <= beforeMs;
    });
  }
  
  // Sort all activities by start date ascending
  finalActivities.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  // Deduplicate
  const uniqueActivities = Array.from(new Map(finalActivities.map(a => [a.id, a])).values());

  return uniqueActivities;
};

export const getActivity = async (contextId: number, id: number, type?: string): Promise<Activity | null> => {
  if (type === 'exercise' || type === 'event' || type === 'incident') {
    const res = await api.get<Activity>(`/team/${contextId}/${type}s/${id}`).catch(() => null);
    if (res?.data && res.data.id) return { ...res.data, type: type as any };
  }

  let res = await api.get<Activity>(`/team/${contextId}/exercises/${id}`).catch(() => null);
  if (res?.data && res.data.id) return { ...res.data, type: 'exercise' as const };
  
  res = await api.get<Activity>(`/team/${contextId}/events/${id}`).catch(() => null);
  if (res?.data && res.data.id) return { ...res.data, type: 'event' as const };
  
  res = await api.get<Activity>(`/team/${contextId}/incidents/${id}`).catch(() => null);
  if (res?.data && res.data.id) return { ...res.data, type: 'incident' as const };

  return null;
};

export const getAttendees = async (contextId: number, exerciseId: number): Promise<Attendee[]> => {
  // Fetch attendance for this specific exercise
  const res = await api.get<{ results: Attendee[] }>(`/team/${contextId}/attendance`, {
    params: {
      activity_id: exerciseId,
      size: 200,
    },
  });
  
  // Filter for ATTENDING only (Confirmed)
  return res.data.results.filter(a => 
    a.status === 'ATTENDING' || 
    a.status === 'attending' || 
    a.status === 'CONFIRMED' || 
    a.status === 'confirmed'
  );
};

export const getMemberDetails = async (contextId: number, memberIds: number[]): Promise<Member[]> => {
  if (memberIds.length === 0) return [];
  const res = await api.get<{ results: Member[] }>(`/team/${contextId}/members`, {
    params: {
      id: memberIds,
      size: memberIds.length,
    },
  });
  return res.data.results;
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

/**
 * Fetches qualification awards for the given members, returning a map of
 * memberId → comma-separated active qualification titles.
 * Fetches all awards for the team and filters client-side (D4H does not
 * support array-based member_id filtering on this endpoint).
 */
export const getMemberQualifications = async (
  contextId: number,
  memberIds: number[]
): Promise<Record<number, string>> => {
  if (memberIds.length === 0) return {};

  const result: Record<number, string> = {};
  const memberIdSet = new Set(memberIds);
  const now = new Date().toISOString();

  console.log('[Quals] Fetching qualification definitions & awards for contextId:', contextId);

  try {
    // 1. Fetch qualification definitions to map qualId -> title
    const defsRes = await api.get<{ results: { id: number; title: string }[] }>(
      `/team/${contextId}/member-qualifications`,
      { params: { size: 250 } }
    ).catch(() => ({ data: { results: [] } }));

    const qualDefMap: Record<number, string> = {};
    (defsRes.data.results ?? []).forEach((q) => {
      if (q.id && q.title) {
        qualDefMap[q.id] = q.title;
      }
    });

    // 2. Paginate through all awards — fetch up to 250 per page
    let page = 1;
    const PAGE_SIZE = 250;
    let totalFetched = 0;

    while (true) {
      const res = await api.get<{ results: MemberQualificationAward[]; count?: number }>(
        `/team/${contextId}/member-qualification-awards`,
        { params: { size: PAGE_SIZE, page } }
      );

      const awards = res.data.results ?? [];
      console.log(`[Quals] Page ${page}: received ${awards.length} awards`);
      if (awards.length === 0) break;

      awards.forEach((award) => {
        const memberId = award.member?.id;
        // Only care about members in our roster
        if (!memberId || !memberIdSet.has(memberId)) return;
        // Skip expired awards (D4H v3 uses endsAt or expiresAt)
        const expiration = award.endsAt || award.expiresAt;
        if (expiration && expiration < now) return;

        const qualId = award.qualification?.id;
        const title = (qualId && qualDefMap[qualId]) || award.qualification?.title;
        if (!title) return;

        // Prevent duplicate titles per member
        const currentQuals = result[memberId] ? result[memberId].split(', ') : [];
        if (!currentQuals.includes(title)) {
          result[memberId] = result[memberId] ? `${result[memberId]}, ${title}` : title;
        }
      });

      totalFetched += awards.length;
      // If we got fewer than a full page, we're done
      if (awards.length < PAGE_SIZE) break;
      page++;
    }

    console.log('[Quals] Total awards fetched:', totalFetched);
    console.log('[Quals] Final qualificationsMap:', result);
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    console.error('[Quals] API call FAILED');
    console.error('[Quals] Error:', err?.response?.status, err?.response?.data ?? err?.message ?? err);
  }

  return result;
};
