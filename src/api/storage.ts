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
  'fitnessqual_panel_layout_',
];

export function isProtectedStorageKey(key: string): boolean {
  return PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export const CURRENT_STORAGE_VERSION = 2;
const STORAGE_VERSION_KEY = 'fitnessqual_storage_version';

/**
 * Automatically migrate legacy data and purge obsolete, uncompressed, or expired
 * cache entries created before the smart caching and quota safety engine.
 */
export function migrateLegacyStorage(): void {
  try {
    const savedVersion = parseInt(localStorage.getItem(STORAGE_VERSION_KEY) || '0', 10);

    // Always prune expired entries on boot
    pruneLocalStorage();

    if (savedVersion >= CURRENT_STORAGE_VERSION) {
      return; // Already up-to-date
    }

    console.log(`[Storage] Migrating legacy storage from version ${savedVersion} to ${CURRENT_STORAGE_VERSION}...`);

    const allKeys = Object.keys(localStorage);
    let cleanedCount = 0;

    for (const key of allKeys) {
      // Never touch protected roster, form, or auth data
      if (isProtectedStorageKey(key)) continue;

      // 1. Remove obsolete uncompressed routes from older versions
      if (key.startsWith('mapbox_route_') || key.startsWith('mapbox_driving_route_')) {
        localStorage.removeItem(key);
        cleanedCount++;
        continue;
      }

      // 2. Remove obsolete or unnormalized geocodes from older versions
      if (key.startsWith('mapbox_geocode_') && !key.startsWith('mapbox_geocode_cache_')) {
        localStorage.removeItem(key);
        cleanedCount++;
        continue;
      }

      // 3. Clean up any temporary or test fill keys
      if (key.includes('stress_test') || key.includes('fill_') || key.includes('test_route_')) {
        localStorage.removeItem(key);
        cleanedCount++;
        continue;
      }

      // 4. Compact unrounded coordinates in existing driving caches
      if (key.startsWith('mapbox_driving_cache_')) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.data?.geometry?.coordinates) {
              const coords = parsed.data.geometry.coordinates;
              const needsRounding = coords.some((c: number[]) =>
                c.some((num: number) => Math.abs(num - Math.round(num * 10000) / 10000) > 0.00001)
              );
              if (needsRounding) {
                parsed.data.geometry.coordinates = coords.map((c: number[]) => [
                  Math.round(c[0] * 10000) / 10000,
                  Math.round(c[1] * 10000) / 10000,
                ]);
                localStorage.setItem(key, JSON.stringify(parsed));
              }
            }
          }
        } catch {
          localStorage.removeItem(key);
          cleanedCount++;
        }
      }

      // 5. Clean up corrupted or stale avatar cache entries
      if (key.startsWith('d4h_avatar_cache_')) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            // Avatars older than 7 days should be purged
            if (!parsed?.timestamp || Date.now() - parsed.timestamp > 7 * 24 * 60 * 60 * 1000) {
              localStorage.removeItem(key);
              cleanedCount++;
            }
          }
        } catch {
          localStorage.removeItem(key);
          cleanedCount++;
        }
      }
    }

    localStorage.setItem(STORAGE_VERSION_KEY, CURRENT_STORAGE_VERSION.toString());
    console.log(`[Storage] Migration complete. Cleaned ${cleanedCount} legacy/stale entries.`);
  } catch (err) {
    console.error('[Storage] Error during storage migration:', err);
  }
}

/**
 * Smart cache pruning strategy:
 * 1. Remove all expired cache entries (routes, geocodes, avatars, weather, etc.)
 * 2. If still full, evict oldest items in tiered LRU order:
 *    - Tier 1: mapbox_driving_cache_
 *    - Tier 2: d4h_avatar_cache_
 *    - Tier 3: weather_cache_
 *    - Tier 4: mapbox_geocode_cache_
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
      evictOldestCacheTier('mapbox_driving_cache_', 0.7);
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
      evictOldestCacheTier('mapbox_geocode_cache_', 0.5);
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
