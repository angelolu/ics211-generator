/**
 * Centralized, Quota-Safe LocalStorage Storage Engine
 * 
 * Guarantees that:
 * 1. Roster data (d4h_form_*, fitnessqual_local_rosters, activity_carpools_*) and Auth credentials
 *    are STRICTLY PROTECTED and NEVER deleted under any eviction scenario.
 * 2. Caches (routes, avatars, weather, geocodes, activity lists) are pruned intelligently using
 *    TTL expiration and LRU tier prioritization when storage quota is reached.
 */

// Protected prefixes and keys that MUST NEVER be removed during eviction
const PROTECTED_KEY_PREFIXES = [
  'd4h_form_',
  'd4h_form_type_',
  'fitnessqual_local_rosters',
  'activity_carpools_',
  'd4h_token',
  'd4h_context_id',
  'd4h_team_title',
  'd4h_team_subdomain',
  'd4h_member_id',
  'd4h_member_name',
  'd4h_active_view_',
  'd4h_highlight_changes',
];

export function isProtectedStorageKey(key: string): boolean {
  return PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Smart cache pruning strategy:
 * 1. Remove all expired cache entries (routes, geocodes, avatars, weather, etc.)
 * 2. If still full, evict oldest items in tiered LRU order:
 *    - Tier 1: mapbox_route_
 *    - Tier 2: d4h_avatar_cache_
 *    - Tier 3: weather_cache_
 *    - Tier 4: mapbox_geocode_
 *    - Tier 5: d4h_activity_cache / d4h_quals_cache_
 * 
 * NEVER removes any protected roster or credential keys.
 */
export function pruneLocalStorage(): void {
  const now = Date.now();
  const allKeys = Object.keys(localStorage);

  // Phase 1: Evict expired entries
  for (const k of allKeys) {
    if (isProtectedStorageKey(k)) continue;

    try {
      const raw = localStorage.getItem(k);
      if (!raw) {
        localStorage.removeItem(k);
        continue;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.timestamp === 'number') {
        // Default max cache life: 24h
        const maxAge = parsed.ttl || (24 * 60 * 60 * 1000);
        if (now - parsed.timestamp >= maxAge) {
          localStorage.removeItem(k);
        }
      }
    } catch {
      // Non-parseable or corrupt non-protected cache item
      localStorage.removeItem(k);
    }
  }
}

/**
 * Perform LRU eviction across tiered cache categories
 */
function evictOldestCacheTier(prefix: string, fraction = 0.5): boolean {
  const items: { key: string; timestamp: number }[] = [];
  for (const k of Object.keys(localStorage)) {
    if (isProtectedStorageKey(k)) continue;
    if (k.startsWith(prefix)) {
      try {
        const raw = localStorage.getItem(k);
        const parsed = raw ? JSON.parse(raw) : null;
        items.push({ key: k, timestamp: parsed?.timestamp || 0 });
      } catch {
        localStorage.removeItem(k);
      }
    }
  }

  if (items.length === 0) return false;

  items.sort((a, b) => a.timestamp - b.timestamp);
  const countToRemove = Math.max(1, Math.ceil(items.length * fraction));
  for (let i = 0; i < countToRemove; i++) {
    localStorage.removeItem(items[i].key);
  }
  return true;
}

/**
 * Safely store an item in localStorage with automatic quota management
 * and strict protection for roster and auth data.
 */
export function safeSetLocalStorageItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.warn(`[Storage] Quota exceeded while saving key "${key}". Running smart prune...`);

    // 1. First attempt: Expired items prune
    try {
      pruneLocalStorage();
      localStorage.setItem(key, value);
      return true;
    } catch { }

    // 2. Second attempt: Evict driving route cache (Tier 1: biggest footprint)
    try {
      evictOldestCacheTier('mapbox_route_', 0.6);
      localStorage.setItem(key, value);
      return true;
    } catch { }

    // 3. Third attempt: Evict oldest member avatar thumbnails (Tier 2)
    try {
      evictOldestCacheTier('d4h_avatar_cache_', 0.5);
      localStorage.setItem(key, value);
      return true;
    } catch { }

    // 4. Fourth attempt: Evict weather & geocode caches (Tier 3 & 4)
    try {
      evictOldestCacheTier('weather_cache_', 0.7);
      evictOldestCacheTier('mapbox_geocode_', 0.5);
      localStorage.setItem(key, value);
      return true;
    } catch { }

    // 5. Fifth attempt: Evict member / quals cache (Tier 5)
    try {
      evictOldestCacheTier('d4h_members_cache_', 0.5);
      evictOldestCacheTier('d4h_quals_cache_', 0.5);
      evictOldestCacheTier('d4h_activity_cache', 1.0);
      localStorage.setItem(key, value);
      return true;
    } catch {
      console.error(`[Storage] Critical: Unable to save key "${key}" even after full cache eviction.`, err);
      return false;
    }
  }
}
