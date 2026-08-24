import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tooltip from '@radix-ui/react-tooltip';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Car,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Edit2,
  Loader2,
  MapPin,
  Maximize2,
  Navigation,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { Activity, Attendee, Member } from '../api/d4h';
import { formatActivityLocation, getMemberLocationQuery, isMemberOutOfStateOrCountry } from '../api/d4h';
import {
  getMapboxToken,
  geocodeAddress,
  getDrivingRoute,
  getMultiStopDrivingRoute,
  calculateDistanceMiles,
  MAX_REASONABLE_DISTANCE_MILES,
  isDrivingRouteCached,
  isMultiStopRouteCached,
  type DrivingRouteResult,
  type MultiStopDrivingRouteResult,
  type DepartureWindowMode,
  type RouteOptions,
} from '../api/mapbox';

interface ActivityMapViewProps {
  activity: Activity | null;
  activityType: string;
  activityName: string;
  attendees: Attendee[];
  members: Member[];
  isLoading?: boolean;
}

interface PlottedMember {
  attendeeId: number;
  memberId: number;
  name: string;
  initials: string;
  color: string;
  role?: string;
  addressText?: string;
  lat: number;
  lng: number;
  source: 'gps' | 'geocoded';
}

interface UnmappedMember {
  attendeeId: number;
  memberId: number;
  name: string;
  initials: string;
  color: string;
  role?: string;
  addressText?: string;
  reason?: string;
}

export interface CarpoolGroup {
  id: string;
  isManual?: boolean;
  name: string;
  color: string;
  driverId: number;
  passengerIds: number[];
  directDurationSeconds: number;
  carpoolDurationSeconds: number;
  detourMinutes: number;
  durationFormatted: string;
  distanceFormatted: string;
  multiStopRoute?: MultiStopDrivingRouteResult;
}

const MEMBER_PALETTE = [
  '#0d9488', // Teal
  '#2563eb', // Royal Blue
  '#d97706', // Amber
  '#7c3aed', // Purple
  '#e11d48', // Rose Red
  '#059669', // Emerald
  '#0284c7', // Sky Blue
  '#c026d3', // Fuchsia
  '#ea580c', // Orange
  '#4f46e5', // Indigo
  '#0891b2', // Cyan
  '#16a34a', // Green
];

function getMemberColor(_memberId: number, index: number): string {
  return MEMBER_PALETTE[Math.abs(index) % MEMBER_PALETTE.length];
}

function getMemberInitials(name: string): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const ActivityMapView: React.FC<ActivityMapViewProps> = ({
  activity,
  activityType: _activityType,
  activityName,
  attendees,
  members,
  isLoading,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const markerElementsRef = useRef<Record<number, HTMLDivElement>>({});
  const animFrameIdRef = useRef<number | null>(null);
  const animTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAnimatedIntroRef = useRef<boolean>(false);
  const handleMapPinClickRef = useRef<(mm: PlottedMember) => void>(() => { });

  const mapboxToken = getMapboxToken();

  // Mode & Detour Settings
  const [viewMode, setViewMode] = useState<'overview' | 'suggestions'>('overview');
  const [departureMode, setDepartureMode] = useState<DepartureWindowMode>('baseline');
  const [maxDetourMinutes, setMaxDetourMinutes] = useState<number>(30);
  const [vehicleCapacity, setVehicleCapacity] = useState<number>(4);

  // Search & Filter in Overview
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'carpool' | 'solo' | 'unmapped'>('all');

  // Selection State (Solo Member IDs & Carpool IDs)
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [selectedCarpoolIds, setSelectedCarpoolIds] = useState<string[]>([]);

  // Map & Member Data
  const [plottedMembers, setPlottedMembers] = useState<PlottedMember[]>([]);
  const [unmappedMembers, setUnmappedMembers] = useState<UnmappedMember[]>([]);
  const [memberRoutes, setMemberRoutes] = useState<Record<number, DrivingRouteResult>>({});
  const [isMapReady, setIsMapReady] = useState<boolean>(false);

  // Helper to format Date to local ISO without seconds (YYYY-MM-DDTHH:mm) for Mapbox depart_at
  const formatLocalIsoTime = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  // Helper to compute RouteOptions for departure windows & traffic
  const getRouteOptionsForDeparture = (estimatedDurationSec = 0): RouteOptions => {
    if (departureMode === 'baseline') {
      return { profile: 'driving', departureKey: 'baseline' };
    }
    if (departureMode === 'now') {
      return { profile: 'driving-traffic', departAt: 'now', departureKey: 'now' };
    }

    const baseDateStr = activity?.startsAt ? activity.startsAt.slice(0, 10) : new Date().toISOString().slice(0, 10);

    if (departureMode === 'morning_rush') {
      return { profile: 'driving-traffic', departAt: `${baseDateStr}T07:30`, departureKey: 'morning_rush' };
    }
    if (departureMode === 'midday') {
      return { profile: 'driving-traffic', departAt: `${baseDateStr}T12:00`, departureKey: 'midday' };
    }
    if (departureMode === 'evening_rush') {
      return { profile: 'driving-traffic', departAt: `${baseDateStr}T17:00`, departureKey: 'evening_rush' };
    }
    if (departureMode === 'activity_start') {
      if (activity?.startsAt) {
        const actStartTime = new Date(activity.startsAt).getTime();
        const targetArrivalMs = actStartTime - 30 * 60 * 1000;
        const departMs = targetArrivalMs - estimatedDurationSec * 1000;
        const departDate = new Date(departMs);
        const departIso = formatLocalIsoTime(departDate);
        return { profile: 'driving-traffic', departAt: departIso, departureKey: 'act_start' };
      } else {
        return { profile: 'driving-traffic', departAt: 'now', departureKey: 'now' };
      }
    }
    return { profile: 'driving', departureKey: 'baseline' };
  };

  // Active Carpools & Modal (Persisted per Activity in localStorage)
  const [activeCarpools, setActiveCarpools] = useState<CarpoolGroup[]>(() => {
    if (!activity?.id) return [];
    try {
      const saved = localStorage.getItem(`activity_carpools_${activity.id}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch { }
    return [];
  });

  useEffect(() => {
    if (!activity?.id) return;
    try {
      localStorage.setItem(`activity_carpools_${activity.id}`, JSON.stringify(activeCarpools));
    } catch { }
  }, [activeCarpools, activity?.id]);

  const [isCreatingCarpool, setIsCreatingCarpool] = useState<boolean>(false);
  const [editingCarpoolId, setEditingCarpoolId] = useState<string | null>(null);
  const [newDriverId, setNewDriverId] = useState<number | null>(null);
  const [newPassengerIds, setNewPassengerIds] = useState<number[]>([]);
  const [isSavingCarpool, setIsSavingCarpool] = useState<boolean>(false);

  // Notice / Undo State for deleted carpools
  const [deletedCarpoolNotice, setDeletedCarpoolNotice] = useState<{
    carpool: CarpoolGroup;
    index: number;
    label: string;
  } | null>(null);
  const deleteNoticeTimerRef = useRef<number | null>(null);

  // Notice State for accepted/created carpools
  const [acceptedCarpoolNotice, setAcceptedCarpoolNotice] = useState<{
    carpool: CarpoolGroup;
    title: string;
    message?: string;
  } | null>(null);
  const acceptNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
      if (acceptNoticeTimerRef.current) clearTimeout(acceptNoticeTimerRef.current);
    };
  }, []);

  const handleDeleteCarpool = (cp: CarpoolGroup, index: number) => {
    const driver = plottedMembers.find((m) => m.memberId === cp.driverId);
    const label = driver ? `${driver.name}'s carpool` : cp.name || 'Carpool';

    setActiveCarpools((prev) => prev.filter((item) => item.id !== cp.id));
    setSelectedCarpoolIds((prev) => prev.filter((id) => id !== cp.id));

    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);

    setDeletedCarpoolNotice({
      carpool: cp,
      index,
      label,
    });

    deleteNoticeTimerRef.current = window.setTimeout(() => {
      setDeletedCarpoolNotice(null);
    }, 6000);
  };

  const handleUndoDeleteCarpool = () => {
    if (!deletedCarpoolNotice) return;
    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);

    const { carpool, index } = deletedCarpoolNotice;
    setActiveCarpools((prev) => {
      const copy = [...prev];
      copy.splice(Math.min(index, copy.length), 0, carpool);
      return copy;
    });
    setSelectedCarpoolIds((prev) => [...prev, carpool.id]);
    setDeletedCarpoolNotice(null);
  };

  // Extract activity coordinates
  let actLat: number | null = null;
  let actLng: number | null = null;
  if (
    activity?.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [coordLng, coordLat] = activity.location.coordinates;
    if (coordLat !== 0 || coordLng !== 0) {
      actLat = coordLat;
      actLng = coordLng;
    }
  }

  const locationText = formatActivityLocation(activity || undefined);

  // Map member lookup
  const memberMap = useMemo(() => {
    const map = new Map<number, Member>();
    members.forEach((m) => map.set(m.id, m));
    return map;
  }, [members]);

  // Lookup for fast member data retrieval (mapped or unmapped)
  const allAttendeeInfo = useMemo(() => {
    const map = new Map<number, { name: string; initials: string; color: string; role?: string; isMapped: boolean }>();
    plottedMembers.forEach((p) => {
      map.set(p.memberId, { name: p.name, initials: p.initials, color: p.color, role: p.role, isMapped: true });
    });
    unmappedMembers.forEach((u) => {
      map.set(u.memberId, { name: u.name, initials: u.initials, color: u.color, role: u.role, isMapped: false });
    });
    return map;
  }, [plottedMembers, unmappedMembers]);

  // 1. Geocoding & coordinate extraction (350-mile cutoff)
  useEffect(() => {
    let isCancelled = false;

    const processMembers = async () => {
      const plotted: PlottedMember[] = [];
      const unmapped: UnmappedMember[] = [];
      const needsGeocode: { att: Attendee; m?: Member; name: string; memberId: number; initials: string; color: string; role?: string; addressText: string }[] = [];

      console.log('[ActivityMapView] processMembers start:', {
        attendeeCount: attendees.length,
        memberMapSize: memberMap.size,
        hasMapboxToken: Boolean(mapboxToken),
        activityCoords: [actLat, actLng],
      });

      // If attendees exist but member profiles are still being fetched, wait for profiles before classifying
      if (attendees.length > 0 && members.length === 0) {
        return;
      }

      attendees.forEach((att, idx) => {
        const m = memberMap.get(att.member?.id);
        const name = att.member?.name || m?.name || 'Responding Member';
        const role = att.role?.title || m?.role?.title || m?.position;
        const memberId = att.member?.id ?? idx;
        const color = getMemberColor(memberId, idx);
        const initials = getMemberInitials(name);

        // Check if member is out-of-state or international
        if (isMemberOutOfStateOrCountry(m)) {
          console.log(`[ActivityMapView] Member #${memberId} (${name}) is marked out-of-state/international.`);
          unmapped.push({ attendeeId: att.id, memberId, name, initials, color, role, addressText: '', reason: 'Out of state or international' });
          return;
        }

        const addressText = getMemberLocationQuery(m);

        // Check if member already has GPS coordinates
        let mLat: number | null = null;
        let mLng: number | null = null;
        if (
          m?.location?.coordinates &&
          Array.isArray(m.location.coordinates) &&
          m.location.coordinates.length >= 2
        ) {
          const [lng, lat] = m.location.coordinates;
          if (lat !== 0 || lng !== 0) {
            mLat = lat;
            mLng = lng;
          }
        }

        console.log(`[ActivityMapView] Evaluating member #${memberId} (${name}):`, {
          hasMemberData: Boolean(m),
          addressText,
          mLat,
          mLng,
          mLocation: m?.location,
        });

        if (mLat != null && mLng != null) {
          const isTooFar =
            actLat != null &&
            actLng != null &&
            calculateDistanceMiles(mLat, mLng, actLat, actLng) > MAX_REASONABLE_DISTANCE_MILES;

          if (isTooFar) {
            console.log(`[ActivityMapView] Member #${memberId} (${name}) GPS coords are > ${MAX_REASONABLE_DISTANCE_MILES} miles away.`);
            unmapped.push({ attendeeId: att.id, memberId, name, initials, color, role, addressText: addressText || '', reason: 'Location exceeds max distance' });
          } else {
            plotted.push({
              attendeeId: att.id,
              memberId,
              name,
              initials,
              color,
              role,
              addressText,
              lat: mLat,
              lng: mLng,
              source: 'gps',
            });
          }
        } else if (addressText) {
          needsGeocode.push({ att, m, name, memberId, initials, color, role, addressText });
        } else {
          console.log(`[ActivityMapView] Member #${memberId} (${name}) has no GPS coordinates and no address text.`);
          unmapped.push({ attendeeId: att.id, memberId, name, initials, color, role, addressText: '', reason: m ? 'No address or coordinates on file' : 'Member profile not loaded' });
        }
      });

      // Geocode addresses with Mapbox Geocoding API if token is available
      if (needsGeocode.length > 0 && mapboxToken) {
        console.log(`[ActivityMapView] Starting geocoding for ${needsGeocode.length} members...`);
        for (const item of needsGeocode) {
          if (isCancelled) break;
          const geocode = await geocodeAddress(item.addressText, mapboxToken);
          if (geocode) {
            const isTooFar =
              actLat != null &&
              actLng != null &&
              calculateDistanceMiles(geocode.lat, geocode.lng, actLat, actLng) > MAX_REASONABLE_DISTANCE_MILES;

            if (isTooFar) {
              console.log(`[ActivityMapView] Geocoded member #${item.memberId} (${item.name}) is > ${MAX_REASONABLE_DISTANCE_MILES} miles away.`);
              unmapped.push({ attendeeId: item.att.id, memberId: item.memberId, name: item.name, initials: item.initials, color: item.color, role: item.role, addressText: item.addressText, reason: 'Location exceeds max distance' });
            } else {
              plotted.push({
                attendeeId: item.att.id,
                memberId: item.memberId,
                name: item.name,
                initials: item.initials,
                color: item.color,
                role: item.role,
                addressText: item.addressText,
                lat: geocode.lat,
                lng: geocode.lng,
                source: 'geocoded',
              });
            }
          } else {
            console.warn(`[ActivityMapView] Geocode failed for member #${item.memberId} (${item.name}) address: "${item.addressText}"`);
            unmapped.push({ attendeeId: item.att.id, memberId: item.memberId, name: item.name, initials: item.initials, color: item.color, role: item.role, addressText: item.addressText, reason: 'Could not geocode address' });
          }
        }
      } else if (needsGeocode.length > 0) {
        console.warn(`[ActivityMapView] ${needsGeocode.length} members have addresses but no Mapbox token is present for geocoding.`);
        needsGeocode.forEach((item) => {
          unmapped.push({ attendeeId: item.att.id, memberId: item.memberId, name: item.name, initials: item.initials, color: item.color, role: item.role, addressText: item.addressText, reason: 'Mapbox token missing for geocoding' });
        });
      }

      console.log('[ActivityMapView] processMembers complete:', {
        plottedCount: plotted.length,
        unmappedCount: unmapped.length,
        plotted,
        unmapped,
      });

      if (!isCancelled) {
        setPlottedMembers(plotted);
        setUnmappedMembers(unmapped);
      }
    };

    processMembers();

    return () => {
      isCancelled = true;
    };
  }, [attendees, memberMap, mapboxToken, actLat, actLng]);

  // 2. Fetch driving routes & compute carpools in a unified pipeline
  const [suggestedCarpools, setSuggestedCarpools] = useState<CarpoolGroup[]>([]);
  const [isCalculatingCarpools, setIsCalculatingCarpools] = useState<boolean>(false);
  const [isCalculatingRoutes, setIsCalculatingRoutes] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    if (!mapboxToken || actLat == null || actLng == null || plottedMembers.length === 0) {
      setSuggestedCarpools([]);
      setIsCalculatingCarpools(false);
      setIsCalculatingRoutes(false);
      return;
    }

    const computeAll = async () => {
      const generalRouteOpts = getRouteOptionsForDeparture();

      // Check if any direct route is missing from cache
      let anyDirectMissing = false;
      for (const mm of plottedMembers) {
        if (!isDrivingRouteCached({ lng: mm.lng, lat: mm.lat }, { lng: actLng!, lat: actLat! }, generalRouteOpts)) {
          anyDirectMissing = true;
          break;
        }
      }

      if (anyDirectMissing) {
        setIsCalculatingRoutes(true);
        setIsCalculatingCarpools(true);
      }

      // Step 1: Fetch/resolve direct driving routes for all plotted members
      const routesMap: Record<number, DrivingRouteResult> = {};
      for (const mm of plottedMembers) {
        if (isCancelled) return;
        const res = await getDrivingRoute(
          { lng: mm.lng, lat: mm.lat },
          { lng: actLng!, lat: actLat! },
          { ...generalRouteOpts, customToken: mapboxToken }
        );
        if (res) {
          routesMap[mm.memberId] = res;
        }
      }

      if (isCancelled) return;

      setMemberRoutes(routesMap);
      setIsCalculatingRoutes(false);

      // Step 2: Compute/refresh routes for active carpools
      if (activeCarpools.length > 0) {
        const updatedActiveList: CarpoolGroup[] = [];
        let hasActiveChange = false;

        for (const ac of activeCarpools) {
          const driver = plottedMembers.find((m) => m.memberId === ac.driverId);
          if (!driver) {
            updatedActiveList.push(ac);
            continue;
          }

          const plottedPassengers = ac.passengerIds
            .map((id) => plottedMembers.find((m) => m.memberId === id))
            .filter((m): m is PlottedMember => !!m);

          const stops = [
            { lng: driver.lng, lat: driver.lat },
            ...plottedPassengers.map((p) => ({ lng: p.lng, lat: p.lat })),
            { lng: actLng!, lat: actLat! },
          ];

          const driverRoute = routesMap[driver.memberId];
          const driverDepOpts = getRouteOptionsForDeparture(driverRoute?.durationSeconds || 0);
          const multi = await getMultiStopDrivingRoute(stops, { ...driverDepOpts, customToken: mapboxToken });

          const directSec = driverRoute?.durationSeconds || ac.directDurationSeconds || 0;
          const totalSec = multi?.durationSeconds || directSec;
          const detourMins = Math.max(0, Math.round((totalSec - directSec) / 60));

          if (
            multi &&
            (multi.durationFormatted !== ac.durationFormatted ||
              multi.distanceFormatted !== ac.distanceFormatted ||
              detourMins !== ac.detourMinutes)
          ) {
            hasActiveChange = true;
            updatedActiveList.push({
              ...ac,
              directDurationSeconds: directSec,
              carpoolDurationSeconds: totalSec,
              detourMinutes: detourMins,
              durationFormatted: multi.durationFormatted,
              distanceFormatted: multi.distanceFormatted,
              multiStopRoute: multi,
            });
          } else {
            updatedActiveList.push(ac);
          }
        }

        if (hasActiveChange && !isCancelled) {
          setActiveCarpools(updatedActiveList);
        }
      }

      // Step 3: Compute suggested carpools using the fresh direct routes
      const activeMemberIds = new Set<number>();
      activeCarpools.forEach((ac) => {
        activeMemberIds.add(ac.driverId);
        ac.passengerIds.forEach((pid) => activeMemberIds.add(pid));
      });

      const availableMembers = plottedMembers.filter((m) => !activeMemberIds.has(m.memberId));
      if (availableMembers.length < 2) {
        setSuggestedCarpools([]);
        setIsCalculatingCarpools(false);
        setIsCalculatingRoutes(false);
        return;
      }

      const suggestions: CarpoolGroup[] = [];
      const assignedIds = new Set<number>();

      // Sort potential drivers by furthest direct distance from incident
      const sortedDrivers = [...availableMembers].sort((a, b) => {
        const distA = calculateDistanceMiles(a.lat, a.lng, actLat!, actLng!);
        const distB = calculateDistanceMiles(b.lat, b.lng, actLat!, actLng!);
        return distB - distA;
      });

      for (const driver of sortedDrivers) {
        if (isCancelled) return;
        if (assignedIds.has(driver.memberId)) continue;

        const driverRoute = routesMap[driver.memberId];
        if (!driverRoute) continue;

        const driverDirectDist = calculateDistanceMiles(driver.lat, driver.lng, actLat!, actLng!);

        // Find candidate pickups along forward corridor
        const candidates = availableMembers
          .filter((other) => {
            if (other.memberId === driver.memberId || assignedIds.has(other.memberId)) return false;
            const otherToIncident = calculateDistanceMiles(other.lat, other.lng, actLat!, actLng!);
            const driverToOther = calculateDistanceMiles(driver.lat, driver.lng, other.lat, other.lng);
            return otherToIncident <= driverDirectDist * 1.05 && driverToOther <= 60;
          })
          .sort((a, b) => {
            const distA = calculateDistanceMiles(a.lat, a.lng, actLat!, actLng!);
            const distB = calculateDistanceMiles(b.lat, b.lng, actLat!, actLng!);
            return distB - distA;
          });

        if (candidates.length === 0) continue;

        const acceptedPassengers: PlottedMember[] = [];
        let bestMultiRoute: MultiStopDrivingRouteResult | null = null;
        let bestDetourMins = 0;

        for (const candidate of candidates) {
          if (acceptedPassengers.length >= vehicleCapacity - 1) break;

          const testPassengers = [...acceptedPassengers, candidate];
          const stops = [
            { lng: driver.lng, lat: driver.lat },
            ...testPassengers.map((p) => ({ lng: p.lng, lat: p.lat })),
            { lng: actLng!, lat: actLat! },
          ];

          const driverDepOpts = getRouteOptionsForDeparture(driverRoute.durationSeconds);
          const isDirectCached = isDrivingRouteCached(
            { lng: driver.lng, lat: driver.lat },
            { lng: actLng!, lat: actLat! },
            driverDepOpts
          );
          const isMultiCached = isMultiStopRouteCached(stops, driverDepOpts);

          if (!isDirectCached || !isMultiCached) {
            setIsCalculatingCarpools(true);
          }

          const [driverDirectAtDep, multiRoute] = await Promise.all([
            getDrivingRoute(
              { lng: driver.lng, lat: driver.lat },
              { lng: actLng!, lat: actLat! },
              { ...driverDepOpts, customToken: mapboxToken }
            ),
            getMultiStopDrivingRoute(stops, { ...driverDepOpts, customToken: mapboxToken }),
          ]);

          if (!multiRoute) continue;

          const directSec = driverDirectAtDep?.durationSeconds || driverRoute.durationSeconds;
          const detourMins = Math.max(0, Math.round((multiRoute.durationSeconds - directSec) / 60));

          if (detourMins <= maxDetourMinutes) {
            acceptedPassengers.push(candidate);
            bestMultiRoute = multiRoute;
            bestDetourMins = detourMins;
          }
        }

        if (acceptedPassengers.length > 0 && bestMultiRoute) {
          assignedIds.add(driver.memberId);
          acceptedPassengers.forEach((p) => assignedIds.add(p.memberId));

          suggestions.push({
            id: `suggested_${driver.memberId}`,
            name: `${driver.name}`,
            color: driver.color,
            driverId: driver.memberId,
            passengerIds: acceptedPassengers.map((p) => p.memberId),
            directDurationSeconds: driverRoute.durationSeconds,
            carpoolDurationSeconds: bestMultiRoute.durationSeconds,
            detourMinutes: bestDetourMins,
            durationFormatted: bestMultiRoute.durationFormatted,
            distanceFormatted: bestMultiRoute.distanceFormatted,
            multiStopRoute: bestMultiRoute,
          });
        }
      }

      if (!isCancelled) {
        setSuggestedCarpools(suggestions);
        setIsCalculatingCarpools(false);
        setIsCalculatingRoutes(false);
      }
    };

    computeAll();

    return () => {
      isCancelled = true;
    };
  }, [plottedMembers, actLat, actLng, maxDetourMinutes, vehicleCapacity, activeCarpools, mapboxToken, departureMode]);

  // Combined carpool list (Active + Suggested)
  const allCarpools = useMemo(() => {
    return [...activeCarpools, ...suggestedCarpools];
  }, [activeCarpools, suggestedCarpools]);

  // Active member IDs across all active carpools
  const activeCarpoolMemberIds = useMemo(() => {
    const set = new Set<number>();
    activeCarpools.forEach((ac) => {
      set.add(ac.driverId);
      ac.passengerIds.forEach((pid) => set.add(pid));
    });
    return set;
  }, [activeCarpools]);

  // Member ID -> Active Carpool Group lookup
  const memberToActiveCarpool = useMemo(() => {
    const map = new Map<number, CarpoolGroup>();
    activeCarpools.forEach((ac) => {
      map.set(ac.driverId, ac);
      ac.passengerIds.forEach((pid) => map.set(pid, ac));
    });
    return map;
  }, [activeCarpools]);

  // 4. Initialize Mapbox GL Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    markersRef.current = {};
    markerElementsRef.current = {};
    setIsMapReady(false);

    if (!mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    const initialCenter: [number, number] =
      actLng != null && actLat != null
        ? [actLng, actLat]
        : plottedMembers.length > 0
          ? [plottedMembers[0].lng, plottedMembers[0].lat]
          : [-122.4194, 37.7749];

    try {
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/calsar-angelolu/cm7r41ta300gy01smfom8euhj',
        center: initialCenter,
        zoom: 12,
      });
      mapInstanceRef.current = map;

      map.on('error', (e) => {
        console.warn('[Mapbox Map Error]:', e.error || e);
        if (e?.error?.message?.includes('Failed to fetch') || (e as any)?.status === 404 || (e as any)?.status === 403) {
          try {
            map.setStyle('mapbox://styles/mapbox/outdoors-v12');
          } catch { }
        }
      });

      map.addControl(new mapboxgl.NavigationControl(), 'top-right');
      map.addControl(new mapboxgl.FullscreenControl(), 'top-right');

      map.on('load', () => {
        setIsMapReady(true);
        const bounds = new mapboxgl.LngLatBounds();
        let hasBounds = false;

        // Add Activity / Incident Marker
        if (actLng != null && actLat != null) {
          bounds.extend([actLng, actLat]);
          hasBounds = true;

          const actEl = document.createElement('div');
          actEl.className = 'mapbox-activity-marker';
          actEl.innerHTML = `
            <div style="
              width: 36px;
              height: 36px;
              background: #061B44;
              border: 3px solid #DCC394;
              border-radius: 50%;
              box-shadow: 0 4px 14px rgba(6,27,68,0.45);
              display: flex;
              align-items: center;
              justify-content: center;
              color: #DCC394;
              cursor: pointer;
            ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </div>
          `;

          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div style="padding: 4px; font-family: inherit;">
              <div style="font-size: 13px; font-weight: 600; color: #0f172a;">
                ${activityName}
              </div>
              ${locationText ? `<div style="font-size: 12px; color: #64748b; margin-top: 2px;">${locationText}</div>` : ''}
              <div style="font-size: 11px; color: #94a3b8; margin-top: 4px; font-family: monospace;">
                ${actLat.toFixed(5)}, ${actLng.toFixed(5)}
              </div>
            </div>
          `);

          const marker = new mapboxgl.Marker(actEl)
            .setLngLat([actLng, actLat])
            .setPopup(popup)
            .addTo(map);

          markersRef.current['activity'] = marker;
        }

        // Add Member Markers with Protected Inner Element
        plottedMembers.forEach((mm) => {
          bounds.extend([mm.lng, mm.lat]);
          hasBounds = true;

          const memEl = document.createElement('div');
          memEl.className = 'mapbox-member-marker-wrapper';
          memEl.style.cursor = 'pointer';

          const innerEl = document.createElement('div');
          innerEl.className = `mapbox-member-marker member-pin-${mm.memberId}`;
          innerEl.style.width = '32px';
          innerEl.style.height = '32px';
          innerEl.style.borderRadius = '50%';
          innerEl.style.background = mm.color;
          innerEl.style.border = '2.5px solid #ffffff';
          innerEl.style.boxShadow = '0 3px 10px rgba(0,0,0,0.25)';
          innerEl.style.display = 'flex';
          innerEl.style.alignItems = 'center';
          innerEl.style.justifyContent = 'center';
          innerEl.style.color = '#ffffff';
          innerEl.style.fontWeight = '600';
          innerEl.style.fontSize = '11px';
          innerEl.style.fontFamily = 'inherit';
          innerEl.style.letterSpacing = '-0.02em';
          innerEl.style.transition = 'opacity 0.25s ease, filter 0.25s ease, transform 0.2s ease';
          innerEl.innerText = mm.initials;

          memEl.appendChild(innerEl);

          memEl.addEventListener('click', (e) => {
            e.stopPropagation();
            handleMapPinClickRef.current(mm);
          });

          markerElementsRef.current[mm.memberId] = innerEl;

          const marker = new mapboxgl.Marker(memEl)
            .setLngLat([mm.lng, mm.lat])
            .addTo(map);

          markersRef.current[`member_${mm.memberId}`] = marker;
        });

        // Initialize Driving Route Source and Layers
        if (!map.getSource('driving-route')) {
          map.addSource('driving-route', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: [],
            },
          });

          // Background casing (navy)
          map.addLayer({
            id: 'driving-route-casing',
            type: 'line',
            source: 'driving-route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#061B44',
              'line-width': 7,
              'line-opacity': 0.75,
            },
          });

          // Main line (dynamic color)
          map.addLayer({
            id: 'driving-route-line',
            type: 'line',
            source: 'driving-route',
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': ['coalesce', ['get', 'color'], '#DCC394'],
              'line-width': 4.5,
              'line-opacity': 0.95,
            },
          });
        }

        // Fit Bounds on initial load
        if (hasBounds) {
          if (plottedMembers.length === 0 && actLng != null && actLat != null) {
            map.flyTo({ center: [actLng, actLat], zoom: 13 });
          } else {
            map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 1000 });
          }
        }
      });
    } catch (e) {
      console.warn('Mapbox GL initialization error:', e);
    }

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      if (animTimeoutIdRef.current) clearTimeout(animTimeoutIdRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [actLat, actLng, activityName, locationText, plottedMembers, mapboxToken]);

  // Ensure Mapbox canvas resizes seamlessly when toggling viewMode
  useEffect(() => {
    const timer = setTimeout(() => {
      mapInstanceRef.current?.resize();
    }, 50);
    return () => clearTimeout(timer);
  }, [viewMode]);

  // Overview Items (Filtered by search & filter pill)
  const filteredOverviewItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // 1. Melded Carpools
    const matchingCarpools = activeCarpools.filter((cp) => {
      if (overviewFilter === 'solo' || overviewFilter === 'unmapped') return false;
      if (!query) return true;
      const driver = plottedMembers.find((m) => m.memberId === cp.driverId);
      const passengerNames = cp.passengerIds.map((pid) => allAttendeeInfo.get(pid)?.name || '').join(' ');
      return (
        cp.name.toLowerCase().includes(query) ||
        (driver && driver.name.toLowerCase().includes(query)) ||
        passengerNames.toLowerCase().includes(query)
      );
    });

    // 2. Solo Plotted Members (Not in any active carpool)
    const soloPlotted = plottedMembers.filter((m) => !activeCarpoolMemberIds.has(m.memberId));
    const matchingSolo = soloPlotted.filter((m) => {
      if (overviewFilter === 'carpool' || overviewFilter === 'unmapped') return false;
      if (!query) return true;
      return (
        m.name.toLowerCase().includes(query) ||
        (m.role && m.role.toLowerCase().includes(query)) ||
        (m.addressText && m.addressText.toLowerCase().includes(query))
      );
    });

    // 3. Unmapped Members (Not in any active carpool)
    const soloUnmapped = unmappedMembers.filter((u) => !activeCarpoolMemberIds.has(u.memberId));
    const matchingUnmapped = soloUnmapped.filter((u) => {
      if (overviewFilter === 'carpool' || overviewFilter === 'solo') return false;
      if (!query) return true;
      return (
        u.name.toLowerCase().includes(query) ||
        (u.role && u.role.toLowerCase().includes(query))
      );
    });

    return {
      carpools: matchingCarpools,
      solo: matchingSolo,
      unmapped: matchingUnmapped,
      totalCount: matchingCarpools.length + matchingSolo.length + matchingUnmapped.length,
    };
  }, [activeCarpools, plottedMembers, unmappedMembers, activeCarpoolMemberIds, searchQuery, overviewFilter, allAttendeeInfo]);

  // Set of member IDs that are currently matching search & filter
  const visibleOverviewMemberIds = useMemo(() => {
    const set = new Set<number>();
    filteredOverviewItems.carpools.forEach((cp) => {
      set.add(cp.driverId);
      cp.passengerIds.forEach((pid) => set.add(pid));
    });
    filteredOverviewItems.solo.forEach((m) => set.add(m.memberId));
    filteredOverviewItems.unmapped.forEach((u) => set.add(u.memberId));
    return set;
  }, [filteredOverviewItems]);

  const isInitialLoading =
    Boolean(isLoading) ||
    (attendees.length > 0 && members.length === 0) ||
    (attendees.length > 0 && plottedMembers.length === 0 && unmappedMembers.length === 0);

  // 5. Update Marker Pin Dimming & Highlighting
  useEffect(() => {
    const selectedCarpoolMemberIds = new Set<number>();
    selectedCarpoolIds.forEach((cpId) => {
      const cp = allCarpools.find((c) => c.id === cpId);
      if (cp) {
        selectedCarpoolMemberIds.add(cp.driverId);
        cp.passengerIds.forEach((pid) => selectedCarpoolMemberIds.add(pid));
      }
    });

    const selectedSoloSet = new Set(selectedMemberIds);
    const hasSelection = selectedCarpoolIds.length > 0 || selectedMemberIds.length > 0;
    const hasFilter = searchQuery.trim().length > 0 || overviewFilter !== 'all';

    plottedMembers.forEach((mm) => {
      const el = markerElementsRef.current[mm.memberId] || (document.querySelector(`.member-pin-${mm.memberId}`) as HTMLDivElement | null);
      if (!el) return;

      if (hasSelection) {
        if (selectedCarpoolMemberIds.has(mm.memberId) || selectedSoloSet.has(mm.memberId)) {
          el.style.opacity = '1';
          el.style.transform = 'scale(1.1)';
        } else {
          el.style.opacity = '0.28';
          el.style.transform = 'scale(1)';
        }
      } else if (viewMode === 'overview' && hasFilter) {
        if (visibleOverviewMemberIds.has(mm.memberId)) {
          el.style.opacity = '1';
          el.style.transform = 'scale(1)';
        } else {
          el.style.opacity = '0.28';
          el.style.transform = 'scale(1)';
        }
      } else {
        el.style.opacity = '1';
        el.style.transform = 'scale(1)';
      }
    });
  }, [selectedMemberIds, selectedCarpoolIds, plottedMembers, viewMode, allCarpools, searchQuery, overviewFilter, visibleOverviewMemberIds]);

  // Action helper: Fit all bounds
  const fitAllBounds = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;
    if (actLng != null && actLat != null) {
      bounds.extend([actLng, actLat]);
      hasPoints = true;
    }
    plottedMembers.forEach((mm) => {
      bounds.extend([mm.lng, mm.lat]);
      hasPoints = true;
    });

    if (hasPoints) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
    }
  };

  // Track whether we had routes selected in the previous render
  const prevHadSelectionRef = useRef<boolean>(false);

  // 6. Draw Multiple Concurrent Driving Routes (Solo drivers + Multi-stop carpools)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isMapReady) return;

    const source = map.getSource('driving-route') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (selectedMemberIds.length === 0 && selectedCarpoolIds.length === 0) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
      // If we previously had routes selected and now unclicked to 0 routes, zoom out to fit all
      if (prevHadSelectionRef.current) {
        prevHadSelectionRef.current = false;
        fitAllBounds();
      }
      return;
    }

    prevHadSelectionRef.current = true;

    const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

    // 1. Add selected solo member routes
    selectedMemberIds.forEach((mId) => {
      const mm = plottedMembers.find((p) => p.memberId === mId);
      const route = memberRoutes[mId];
      if (mm && route?.geometry?.coordinates) {
        features.push({
          type: 'Feature',
          properties: {
            color: mm.color,
          },
          geometry: route.geometry,
        });
      }
    });

    // 2. Add selected carpool routes (multi-stop route geometry or direct driver route)
    selectedCarpoolIds.forEach((cpId) => {
      const cp = allCarpools.find((c) => c.id === cpId);
      if (!cp) return;

      const routeGeom = cp.multiStopRoute?.geometry || memberRoutes[cp.driverId]?.geometry;
      if (routeGeom?.coordinates) {
        features.push({
          type: 'Feature',
          properties: {
            color: cp.color,
          },
          geometry: routeGeom,
        });
      }
    });

    if (map.getLayer('driving-route-line')) {
      map.setPaintProperty('driving-route-line', 'line-opacity', 0.95);
    }
    if (map.getLayer('driving-route-casing')) {
      map.setPaintProperty('driving-route-casing', 'line-opacity', 0.75);
    }

    source.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [selectedMemberIds, selectedCarpoolIds, plottedMembers, memberRoutes, allCarpools, isMapReady, actLat, actLng]);

  // 7. Route Animation Helper (Animates all solo routes + single multi-stop routes per carpool)
  const playIntroAnimation = (delayMs = 0, shouldFitBounds = false) => {
    if (!isMapReady || plottedMembers.length === 0 || !mapInstanceRef.current) return;

    // Collect solo driver routes
    const availableSolo = plottedMembers
      .filter((mm) => !activeCarpoolMemberIds.has(mm.memberId))
      .map((mm) => {
        const route = memberRoutes[mm.memberId];
        return {
          color: mm.color,
          coords: route?.geometry?.coordinates,
        };
      })
      .filter((item): item is { color: string; coords: [number, number][] } =>
        Array.isArray(item.coords) && item.coords.length >= 2
      );

    // Collect active carpool multi-stop routes
    const availableCarpools = activeCarpools
      .map((cp) => {
        const coords = cp.multiStopRoute?.geometry?.coordinates || memberRoutes[cp.driverId]?.geometry?.coordinates;
        return {
          color: cp.color,
          coords,
        };
      })
      .filter((item): item is { color: string; coords: [number, number][] } =>
        Array.isArray(item.coords) && item.coords.length >= 2
      );

    const allRoutePaths = [...availableSolo, ...availableCarpools];
    if (allRoutePaths.length === 0) return;

    cancelAnimation();
    setSelectedMemberIds([]);
    setSelectedCarpoolIds([]);

    const map = mapInstanceRef.current;
    const source = map.getSource('driving-route') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (map.getLayer('driving-route-line')) {
      map.setPaintProperty('driving-route-line', 'line-opacity', 0.95);
    }
    if (map.getLayer('driving-route-casing')) {
      map.setPaintProperty('driving-route-casing', 'line-opacity', 0.75);
    }
    if (shouldFitBounds) {
      fitAllBounds();
    }

    const startAnim = () => {
      const startTime = performance.now();
      const duration = 850;

      const animateForward = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const easeProgress = 1 - Math.pow(1 - progress, 3);

        const features: GeoJSON.Feature<GeoJSON.LineString>[] = allRoutePaths.map(({ color, coords }) => {
          const sliceCount = Math.max(2, Math.floor(coords.length * easeProgress));
          return {
            type: 'Feature',
            properties: {
              color,
            },
            geometry: {
              type: 'LineString',
              coordinates: coords.slice(0, sliceCount),
            },
          };
        });

        source.setData({
          type: 'FeatureCollection',
          features,
        });

        if (progress < 1) {
          animFrameIdRef.current = requestAnimationFrame(animateForward);
        } else {
          animTimeoutIdRef.current = window.setTimeout(() => {
            const retractStartTime = performance.now();
            const retractDuration = 650;

            const animateRetract = (retractNow: number) => {
              const retractElapsed = retractNow - retractStartTime;
              const rProgress = Math.min(1, retractElapsed / retractDuration);
              const easeRetract = Math.pow(rProgress, 2.5);

              const retractFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = allRoutePaths.map(({ color, coords }) => {
                const startIndex = Math.min(coords.length - 2, Math.floor(coords.length * easeRetract));
                return {
                  type: 'Feature',
                  properties: {
                    color,
                  },
                  geometry: {
                    type: 'LineString',
                    coordinates: coords.slice(startIndex),
                  },
                };
              });

              source.setData({
                type: 'FeatureCollection',
                features: retractFeatures,
              });

              if (map.getLayer('driving-route-line')) {
                map.setPaintProperty('driving-route-line', 'line-opacity', 0.95 * (1 - rProgress));
              }
              if (map.getLayer('driving-route-casing')) {
                map.setPaintProperty('driving-route-casing', 'line-opacity', 0.75 * (1 - rProgress));
              }

              if (rProgress < 1) {
                animFrameIdRef.current = requestAnimationFrame(animateRetract);
              } else {
                source.setData({
                  type: 'FeatureCollection',
                  features: [],
                });
                if (map.getLayer('driving-route-line')) {
                  map.setPaintProperty('driving-route-line', 'line-opacity', 0.95);
                }
                if (map.getLayer('driving-route-casing')) {
                  map.setPaintProperty('driving-route-casing', 'line-opacity', 0.75);
                }
                if (shouldFitBounds) {
                  fitAllBounds();
                }
              }
            };

            animFrameIdRef.current = requestAnimationFrame(animateRetract);
          }, 1000);
        }
      };

      animFrameIdRef.current = requestAnimationFrame(animateForward);
    };

    if (delayMs > 0) {
      animTimeoutIdRef.current = window.setTimeout(startAnim, delayMs);
    } else {
      startAnim();
    }
  };

  // Helper to immediately abort any running route animation loop and restore map layer opacities
  const cancelAnimation = () => {
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
      animFrameIdRef.current = null;
    }
    if (animTimeoutIdRef.current) {
      clearTimeout(animTimeoutIdRef.current);
      animTimeoutIdRef.current = null;
    }
    const map = mapInstanceRef.current;
    if (map) {
      if (map.getLayer('driving-route-line')) {
        map.setPaintProperty('driving-route-line', 'line-opacity', 0.95);
      }
      if (map.getLayer('driving-route-casing')) {
        map.setPaintProperty('driving-route-casing', 'line-opacity', 0.75);
      }
    }
  };

  // Initial animation trigger on first load
  useEffect(() => {
    if (
      !isMapReady ||
      hasAnimatedIntroRef.current ||
      plottedMembers.length === 0 ||
      !mapInstanceRef.current
    ) {
      return;
    }

    const available = plottedMembers
      .map((mm) => memberRoutes[mm.memberId]?.geometry?.coordinates)
      .filter((coords): coords is [number, number][] => Array.isArray(coords) && coords.length >= 2);

    if (available.length === 0 || available.length < plottedMembers.length) {
      return;
    }

    hasAnimatedIntroRef.current = true;
    playIntroAnimation(1500);

    return () => {
      cancelAnimation();
    };
  }, [isMapReady, plottedMembers, memberRoutes]);

  const clearActiveRoute = () => {
    cancelAnimation();
    setSelectedMemberIds([]);
    setSelectedCarpoolIds([]);
    const map = mapInstanceRef.current;
    if (!map) return;

    const source = map.getSource('driving-route') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }

    fitAllBounds();
  };

  // Map pin click handler: Selects carpool if member is carpooling, or selects individual route
  const handleMapPinClick = async (mm: PlottedMember) => {
    cancelAnimation();

    // Check if member is part of an active carpool
    const activeCp = memberToActiveCarpool.get(mm.memberId);
    if (activeCp) {
      setSelectedMemberIds((prev) => prev.filter((id) => id !== mm.memberId));
      handleCarpoolClick(activeCp);
      return;
    }

    // In suggestions mode, check if member is part of a suggested carpool
    if (viewMode === 'suggestions') {
      const suggestedCp = suggestedCarpools.find(
        (c) => c.driverId === mm.memberId || c.passengerIds.includes(mm.memberId)
      );
      if (suggestedCp) {
        setSelectedMemberIds((prev) => prev.filter((id) => id !== mm.memberId));
        handleCarpoolClick(suggestedCp);
        return;
      }
    }

    // Solo member selection
    handleSoloMemberClick(mm);
  };
  handleMapPinClickRef.current = handleMapPinClick;

  // Toggle solo member selection in Overview sidebar
  const handleSoloMemberClick = async (mm: PlottedMember) => {
    cancelAnimation();

    setSelectedMemberIds((prev) =>
      prev.includes(mm.memberId) ? prev.filter((id) => id !== mm.memberId) : [...prev, mm.memberId]
    );

    if (actLng != null && actLat != null && mapboxToken && !memberRoutes[mm.memberId]) {
      const route = await getDrivingRoute(
        { lng: mm.lng, lat: mm.lat },
        { lng: actLng, lat: actLat },
        mapboxToken
      );
      if (route) {
        setMemberRoutes((prev) => ({ ...prev, [mm.memberId]: route }));
      }
    }
  };

  // Handle clicking a carpool group (Toggles carpool selection)
  const handleCarpoolClick = async (carpool: CarpoolGroup) => {
    cancelAnimation();

    if (viewMode === 'suggestions') {
      setSelectedCarpoolIds((prev) =>
        prev.includes(carpool.id) ? [] : [carpool.id]
      );
    } else {
      setSelectedCarpoolIds((prev) =>
        prev.includes(carpool.id)
          ? prev.filter((id) => id !== carpool.id)
          : [...prev, carpool.id]
      );
    }

    // Ensure carpool multi-stop route is loaded if missing
    if (!carpool.multiStopRoute && actLat != null && actLng != null && mapboxToken) {
      const driver = plottedMembers.find((m) => m.memberId === carpool.driverId);
      const plottedPassengers = carpool.passengerIds
        .map((id) => plottedMembers.find((m) => m.memberId === id))
        .filter((m): m is PlottedMember => !!m);

      if (driver) {
        const stops = [
          { lng: driver.lng, lat: driver.lat },
          ...plottedPassengers.map((p) => ({ lng: p.lng, lat: p.lat })),
          { lng: actLng, lat: actLat },
        ];
        const driverRoute = memberRoutes[driver.memberId];
        const driverDepOpts = getRouteOptionsForDeparture(driverRoute?.durationSeconds || 0);
        const multi = await getMultiStopDrivingRoute(stops, { ...driverDepOpts, customToken: mapboxToken });
        if (multi) {
          setActiveCarpools((prev) =>
            prev.map((c) => (c.id === carpool.id ? { ...c, multiStopRoute: multi } : c))
          );
        }
      }
    }
  };

  // Accept a suggested carpool into Active Carpools
  const handleAcceptCarpool = (carpool: CarpoolGroup) => {
    const acceptedGroup: CarpoolGroup = {
      ...carpool,
      id: `active_${Date.now()}`,
      isManual: true,
    };
    setActiveCarpools((prev) => [acceptedGroup, ...prev]);
    setSelectedCarpoolIds((prev) => [acceptedGroup.id, ...prev.filter((id) => id !== carpool.id)]);

    const driver = plottedMembers.find((m) => m.memberId === carpool.driverId);
    const label = driver ? `${driver.name}'s carpool` : carpool.name || 'Carpool';

    if (acceptNoticeTimerRef.current) clearTimeout(acceptNoticeTimerRef.current);
    if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
    setDeletedCarpoolNotice(null);

    setAcceptedCarpoolNotice({
      carpool: acceptedGroup,
      title: `${label} accepted`,
      message: 'View this carpool in the Overview tab',
    });

    acceptNoticeTimerRef.current = window.setTimeout(() => {
      setAcceptedCarpoolNotice(null);
    }, 6000);
  };

  // Open modal to modify a suggested or active carpool
  const handleOpenModifyCarpool = (carpool: CarpoolGroup) => {
    setEditingCarpoolId(carpool.id);
    setNewDriverId(carpool.driverId);
    setNewPassengerIds([...carpool.passengerIds]);
    setIsCreatingCarpool(true);
  };

  // Save manual / modified carpool
  const handleSaveManualCarpool = async () => {
    if (!newDriverId || newPassengerIds.length === 0 || actLat == null || actLng == null || !mapboxToken) return;

    setIsSavingCarpool(true);
    const driver = plottedMembers.find((m) => m.memberId === newDriverId);
    const plottedPassengers = newPassengerIds
      .map((id) => plottedMembers.find((m) => m.memberId === id))
      .filter((m): m is PlottedMember => !!m);

    if (!driver) {
      setIsSavingCarpool(false);
      return;
    }

    const stops = [
      { lng: driver.lng, lat: driver.lat },
      ...plottedPassengers.map((p) => ({ lng: p.lng, lat: p.lat })),
      { lng: actLng, lat: actLat },
    ];

    const multiRoute = await getMultiStopDrivingRoute(stops, mapboxToken);
    const directRoute = memberRoutes[driver.memberId];
    const directSec = directRoute?.durationSeconds || 0;
    const totalSec = multiRoute?.durationSeconds || directSec;
    const detourMins = Math.max(0, Math.round((totalSec - directSec) / 60));

    const savedGroup: CarpoolGroup = {
      id: editingCarpoolId && !editingCarpoolId.startsWith('suggested_') ? editingCarpoolId : `active_${Date.now()}`,
      isManual: true,
      name: `${driver.name}`,
      color: driver.color,
      driverId: driver.memberId,
      passengerIds: newPassengerIds,
      directDurationSeconds: directSec,
      carpoolDurationSeconds: totalSec,
      detourMinutes: detourMins,
      durationFormatted: multiRoute?.durationFormatted || 'N/A',
      distanceFormatted: multiRoute?.distanceFormatted || 'N/A',
      multiStopRoute: multiRoute || undefined,
    };

    setActiveCarpools((prev) => {
      const filtered = prev.filter((item) => item.id !== savedGroup.id);
      return [savedGroup, ...filtered];
    });

    setIsCreatingCarpool(false);
    setEditingCarpoolId(null);
    setNewDriverId(null);
    setNewPassengerIds([]);
    setIsSavingCarpool(false);

    handleCarpoolClick(savedGroup);

    // Show notification alert if user creates/updates carpool while not on Overview tab
    if (viewMode !== 'overview') {
      const label = `${driver.name}'s carpool`;
      if (acceptNoticeTimerRef.current) clearTimeout(acceptNoticeTimerRef.current);
      if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
      setDeletedCarpoolNotice(null);

      setAcceptedCarpoolNotice({
        carpool: savedGroup,
        title: editingCarpoolId ? `${label} updated` : `${label} created`,
        message: 'View this carpool in the Overview tab',
      });

      acceptNoticeTimerRef.current = window.setTimeout(() => {
        setAcceptedCarpoolNotice(null);
      }, 6000);
    }
  };

  // Members available for new/modify carpool modal (mapped & unmapped, excluding those in OTHER active carpools)
  const modalAvailableMembers = useMemo(() => {
    const otherActiveMemberIds = new Set<number>();
    activeCarpools.forEach((c) => {
      if (c.id !== editingCarpoolId) {
        otherActiveMemberIds.add(c.driverId);
        c.passengerIds.forEach((pid) => otherActiveMemberIds.add(pid));
      }
    });

    const drivers = plottedMembers.filter((m) => !otherActiveMemberIds.has(m.memberId));
    const passengersMapped = plottedMembers.filter((m) => !otherActiveMemberIds.has(m.memberId));
    const passengersUnmapped = unmappedMembers.filter((u) => !otherActiveMemberIds.has(u.memberId));

    return {
      drivers,
      passengersMapped,
      passengersUnmapped,
      allPassengers: [...passengersMapped, ...passengersUnmapped],
    };
  }, [plottedMembers, unmappedMembers, activeCarpools, editingCarpoolId]);

  return (
    <div className="activity-map-view animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Main Map Header Toolbar ────────────────────────────── */}
      <div
        className="card"
        style={{
          padding: '12px 18px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* Left: Mode Switcher & Geocode Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Compass size={18} style={{ color: 'var(--navy-7)' }} />

          {/* Mode Switcher Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--slate-3)',
              padding: 3,
              borderRadius: 8,
              gap: 2,
            }}
          >
            <button
              onClick={() => {
                setViewMode('overview');
                clearActiveRoute();
              }}
              style={{
                border: 'none',
                background: viewMode === 'overview' ? 'white' : 'transparent',
                color: viewMode === 'overview' ? 'var(--navy-9)' : 'var(--slate-10)',
                fontWeight: 600,
                fontSize: '0.8125rem',
                padding: '5px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: viewMode === 'overview' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <Users size={14} />
              <span>Overview</span>
              {attendees.length > 0 && (
                <span
                  style={{
                    background: 'var(--slate-4)',
                    color: 'var(--slate-11)',
                    fontSize: '0.6875rem',
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontWeight: 700,
                  }}
                >
                  {attendees.length}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setViewMode('suggestions');
                clearActiveRoute();
              }}
              style={{
                border: 'none',
                background: viewMode === 'suggestions' ? 'white' : 'transparent',
                color: viewMode === 'suggestions' ? 'var(--navy-9)' : 'var(--slate-10)',
                fontWeight: 600,
                fontSize: '0.8125rem',
                padding: '5px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: viewMode === 'suggestions' ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <Car size={14} />
              <span>Carpool Suggestions</span>
              {suggestedCarpools.length > 0 && (
                <span
                  style={{
                    background: 'var(--teal-2)',
                    color: 'var(--teal-9)',
                    fontSize: '0.6875rem',
                    padding: '1px 5px',
                    borderRadius: 4,
                    fontWeight: 700,
                  }}
                >
                  {suggestedCarpools.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Right: Promoted Actions (Animate Icon, Departure Window, Add Carpool, Fit All) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Animate Icon Button (Overview Mode Only) */}
          {viewMode === 'overview' && (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => playIntroAnimation(0, false)}
                  className="btn btn-secondary btn-sm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 29,
                    height: 29,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                  title="Replay animated corridor driving routes"
                  aria-label="Replay animated routes"
                >
                  <Play size={13} style={{ marginLeft: 1 }} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip-content" side="top" sideOffset={5}>
                  Replay animated routes
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}

          {/* Departure Window Selector (Shadcn / Radix UI Theme) */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="btn btn-secondary btn-sm"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: 'white',
                  border: '1px solid var(--slate-4)',
                  borderRadius: 6,
                  color: 'var(--slate-12)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  cursor: 'pointer',
                }}
                title="Select departure time window for traffic and routing calculations"
              >
                <Clock size={13} style={{ color: 'var(--slate-9)' }} />
                <span style={{ color: 'var(--slate-10)', fontWeight: 500 }}>Traffic:</span>                <span>
                  {departureMode === 'baseline'
                    ? 'Average'
                    : departureMode === 'now'
                      ? 'Leave Now'
                      : departureMode === 'activity_start'
                        ? 'Arrive by start time'
                        : departureMode === 'morning_rush'
                          ? 'Morning Rush (07:30)'
                          : departureMode === 'midday'
                            ? 'Midday (12:00)'
                            : 'Evening Rush (17:00)'}
                </span>
                <ChevronDown size={12} style={{ color: 'var(--slate-9)', marginLeft: 2 }} />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="select-content no-print animate-fade-in"
                align="end"
                sideOffset={6}
                style={{
                  minWidth: 210,
                  background: 'white',
                  border: '1px solid var(--slate-4)',
                  borderRadius: 8,
                  padding: 4,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  zIndex: 9999,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <div
                  style={{
                    padding: '6px 8px 4px',
                    fontSize: '0.6875rem',
                    fontWeight: 700,
                    color: 'var(--slate-9)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Departure Window
                </div>

                {[
                  { value: 'baseline', label: 'Average', desc: 'Standard traffic estimates' },
                  { value: 'now', label: 'Leave Now', desc: 'Real-time live traffic' },
                  { value: 'activity_start', label: 'Arrive by start time', desc: 'Target 30m prior to start' },
                  { value: 'morning_rush', label: 'Morning Rush (07:30)', desc: 'Peak morning commute' },
                  { value: 'midday', label: 'Midday (12:00)', desc: 'Midday traffic flow' },
                  { value: 'evening_rush', label: 'Evening Rush (17:00)', desc: 'Peak evening commute' },
                ].map((opt) => {
                  const isSelected = departureMode === opt.value;
                  return (
                    <DropdownMenu.Item
                      key={opt.value}
                      className="select-item"
                      onSelect={() => setDepartureMode(opt.value as DepartureWindowMode)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        borderRadius: 6,
                        fontSize: '0.8125rem',
                        fontWeight: isSelected ? 600 : 500,
                        color: isSelected ? 'var(--navy-9)' : 'var(--slate-12)',
                        background: isSelected ? 'var(--navy-1)' : 'transparent',
                        cursor: 'pointer',
                        outline: 'none',
                        transition: 'background 0.12s ease',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span>{opt.label}</span>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--slate-9)', fontWeight: 400 }}>
                          {opt.desc}
                        </span>
                      </div>
                      {isSelected && (
                        <Check size={14} style={{ color: 'var(--navy-9)', marginLeft: 8, flexShrink: 0 }} />
                      )}
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Add Carpool Button */}
          <button
            onClick={() => {
              setEditingCarpoolId(null);
              setNewDriverId(null);
              setNewPassengerIds([]);
              setIsCreatingCarpool(true);
            }}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
            title="Create a new carpool group"
          >
            <Plus size={14} />
            <span>Add Carpool</span>
          </button>

          {/* Fit All Button */}
          <button
            onClick={fitAllBounds}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
            title="Fit map to all responders and incident"
          >
            <Maximize2 size={13} />
            <span>Fit All</span>
          </button>
        </div>
      </div>

      {/* ── Missing Token Notice ──────────────────────────── */}
      {!mapboxToken && (
        <div
          className="card"
          style={{
            padding: '16px 20px',
            background: 'var(--slate-2)',
            border: '1px solid var(--slate-4)',
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--slate-12)' }}>
            Mapbox Token Required
          </div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--slate-10)', marginTop: 4 }}>
            Please set <code>VITE_MAPBOX_TOKEN</code> in your <code>.env</code> file or repo secrets to enable the Mapbox outdoor vector map and driving routes.
          </div>
        </div>
      )}

      {/* ── Main Map Canvas + Side Panel ────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr minmax(320px, 390px)',
          gap: 16,
          height: 'calc(100vh - 240px)',
          minHeight: 480,
          maxHeight: 900,
          alignItems: 'stretch',
        }}
      >
        {/* Mapbox Map Canvas */}
        <div
          className="card"
          style={{
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
            padding: 0,
            borderRadius: 12,
            border: '1px solid var(--slate-4)',
          }}
        >
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

          {/* Floating Map Legend */}
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 16,
              zIndex: 10,
              background: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--slate-4)',
              borderRadius: 8,
              padding: '8px 12px',
              boxShadow: '0 4px 14px rgba(6,27,68,0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#061B44',
                  border: '2px solid #DCC394',
                }}
              />
              <span style={{ fontWeight: 500, color: 'var(--slate-12)' }}>{locationText || 'Destination'}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#0d9488',
                  border: '1px solid #ffffff',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px',
                  color: 'white',
                  fontWeight: 600,
                }}
              >
                M
              </div>
              <span style={{ fontWeight: 500, color: 'var(--slate-12)' }}>
                Members
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Panel: Overview vs Carpool Suggestions */}
        <div
          className="card"
          style={{
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            height: '100%',
            overflowY: 'auto',
          }}
        >
          {/* Destination Header (Overview only) */}
          {viewMode === 'overview' && (
            <div style={{ paddingBottom: 10, borderBottom: '1px solid var(--slate-3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={15} style={{ color: 'var(--slate-9)' }} />
                <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--slate-12)' }}>
                  Destination
                </span>
              </div>
              <div style={{ marginLeft: 21, marginTop: 2 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--slate-12)' }}>
                  {locationText || activityName || 'Location'}
                </div>
                {actLat != null && actLng != null ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate-9)', fontFamily: 'monospace', marginTop: 1 }}>
                    {actLat.toFixed(5)}, {actLng.toFixed(5)}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--slate-8)' }}>
                    No GPS coordinates available
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── MODE 1: OVERVIEW ──────────────────────────────── */}
          {viewMode === 'overview' && (
            <>
              {/* Search & Filter Toolbar in Overview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Search Input Box */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--slate-2)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--slate-4)',
                  }}
                >
                  <Search size={14} style={{ color: 'var(--slate-9)' }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for a member..."
                    style={{
                      border: 'none',
                      background: 'transparent',
                      fontSize: '0.8125rem',
                      width: '100%',
                      outline: 'none',
                      color: 'var(--slate-12)',
                    }}
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--slate-8)' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Filter Pills */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    onClick={() => setOverviewFilter('all')}
                    style={{
                      border: 'none',
                      background: overviewFilter === 'all' ? 'var(--navy-9)' : 'var(--slate-3)',
                      color: overviewFilter === 'all' ? 'white' : 'var(--slate-11)',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    All ({activeCarpools.length + (plottedMembers.length - activeCarpoolMemberIds.size) + (unmappedMembers.length - Array.from(activeCarpoolMemberIds).filter(id => unmappedMembers.some(u => u.memberId === id)).length)})
                  </button>

                  <button
                    onClick={() => setOverviewFilter('carpool')}
                    style={{
                      border: 'none',
                      background: overviewFilter === 'carpool' ? 'var(--navy-9)' : 'var(--slate-3)',
                      color: overviewFilter === 'carpool' ? 'white' : 'var(--slate-11)',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Carpools ({activeCarpools.length})
                  </button>

                  <button
                    onClick={() => setOverviewFilter('solo')}
                    style={{
                      border: 'none',
                      background: overviewFilter === 'solo' ? 'var(--navy-9)' : 'var(--slate-3)',
                      color: overviewFilter === 'solo' ? 'white' : 'var(--slate-11)',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Solo ({plottedMembers.filter(m => !activeCarpoolMemberIds.has(m.memberId)).length})
                  </button>

                  <button
                    onClick={() => setOverviewFilter('unmapped')}
                    style={{
                      border: 'none',
                      background: overviewFilter === 'unmapped' ? 'var(--navy-9)' : 'var(--slate-3)',
                      color: overviewFilter === 'unmapped' ? 'white' : 'var(--slate-11)',
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Unmapped ({unmappedMembers.filter(u => !activeCarpoolMemberIds.has(u.memberId)).length})
                  </button>
                </div>
              </div>

              {/* Overview Cards List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {isInitialLoading ? (
                  // Progressive Skeleton Loading Placeholders
                  Array.from({ length: Math.max(attendees.length, 3) }).map((_, idx) => (
                    <div
                      key={`placeholder_${idx}`}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: 'var(--slate-1)',
                        border: '1px solid var(--slate-3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div className="skeleton" style={{ width: 32, height: 32, minWidth: 32, borderRadius: '50%' }} />
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="skeleton" style={{ width: '55%', height: 14, borderRadius: 4 }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="skeleton" style={{ width: 48, height: 11, borderRadius: 4 }} />
                          <div className="skeleton" style={{ width: 40, height: 11, borderRadius: 4 }} />
                        </div>
                      </div>
                    </div>
                  ))
                ) : filteredOverviewItems.totalCount === 0 ? (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--slate-8)', padding: '16px 0', textAlign: 'center' }}>
                    No matching members found
                  </div>
                ) : (
                  <>
                    {/* 1. Melded Carpool Cards */}
                    {filteredOverviewItems.carpools.map((cp, cpIdx) => {
                      const isSelected = selectedCarpoolIds.includes(cp.id);
                      const hasAnySelection = selectedMemberIds.length > 0 || selectedCarpoolIds.length > 0;
                      const isDimmed = hasAnySelection && !isSelected;
                      const driver = plottedMembers.find((m) => m.memberId === cp.driverId);
                      const plottedPassengers = cp.passengerIds
                        .map((id) => plottedMembers.find((m) => m.memberId === id))
                        .filter((m): m is PlottedMember => !!m);
                      const unmappedPassengers = cp.passengerIds
                        .map((id) => unmappedMembers.find((u) => u.memberId === id))
                        .filter((u): u is UnmappedMember => !!u);

                      const allPassengers = [...plottedPassengers, ...unmappedPassengers];
                      const allNames = [driver?.name || cp.name, ...allPassengers.map((p) => p.name)].join(', ');
                      const hasUnmapped = unmappedPassengers.length > 0;
                      const detourText = hasUnmapped ? `${cp.detourMinutes}m+ detour` : `${cp.detourMinutes}m detour`;
                      const isCalculating = isCalculatingRoutes || isCalculatingCarpools || (!cp.multiStopRoute && !memberRoutes[cp.driverId] && mapboxToken && actLat != null && actLng != null);

                      return (
                        <div
                          key={cp.id}
                          onClick={() => handleCarpoolClick(cp)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: isSelected ? 'var(--navy-1)' : 'var(--slate-1)',
                            border: isSelected ? `2px solid ${cp.color}` : '1px solid var(--slate-3)',
                            opacity: isDimmed ? 0.45 : 1,
                            filter: isDimmed ? 'grayscale(20%)' : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                          }}
                          className="hover-card-item"
                        >
                          {/* Left: Avatar Stack with Passenger Icons Peeping at the Bottom */}
                          <div
                            style={{
                              position: 'relative',
                              width: 32,
                              minWidth: 32,
                              height: Math.max(34, 32 + allPassengers.length * 8),
                              marginTop: 2,
                            }}
                          >
                            {/* Passenger Avatars peeping below */}
                            {allPassengers.map((passenger, pIdx) => (
                              <div
                                key={passenger.memberId}
                                style={{
                                  position: 'absolute',
                                  top: 10 + (pIdx + 1) * 8,
                                  left: 2,
                                  width: 28,
                                  height: 28,
                                  borderRadius: '50%',
                                  background: passenger.color,
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 600,
                                  fontSize: '9px',
                                  letterSpacing: '-0.02em',
                                  border: '2px solid #ffffff',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                                  zIndex: Math.max(1, 8 - pIdx),
                                }}
                                title={`Passenger: ${passenger.name}`}
                              >
                                {passenger.initials}
                              </div>
                            ))}

                            {/* Driver Avatar on Top */}
                            <div
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                background: cp.color,
                                color: '#ffffff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 600,
                                fontSize: '11px',
                                letterSpacing: '-0.02em',
                                border: '2px solid #ffffff',
                                boxShadow: isSelected
                                  ? `0 0 0 2px #061B44, 0 3px 8px rgba(0,0,0,0.3)`
                                  : '0 2px 6px rgba(0,0,0,0.15)',
                                zIndex: 10,
                              }}
                              title={`Driver: ${driver?.name || 'Driver'}`}
                            >
                              {driver?.initials || 'DR'}
                            </div>
                          </div>

                          {/* Middle: Content (Comma-Separated Names Title & Route Stats) */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Title: Driver Name, Passenger 1, Passenger 2, ... */}
                            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-12)', display: 'block', lineHeight: 1.35 }}>
                              {allNames}
                            </span>

                            {/* Travel Time, Distance & Detour (with skeleton shimmer while calculating) */}
                            {isCalculating ? (
                              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div className="skeleton" style={{ width: 52, height: 13, borderRadius: 4 }} />
                                <div className="skeleton" style={{ width: 44, height: 13, borderRadius: 4 }} />
                                <div className="skeleton" style={{ width: 58, height: 16, borderRadius: 4 }} />
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.8125rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, color: 'var(--slate-12)' }}>
                                  {cp.durationFormatted}
                                </span>
                                <span style={{ fontWeight: 400, color: 'var(--slate-10)', fontSize: '0.75rem' }}>
                                  ({cp.distanceFormatted})
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.6875rem',
                                    fontWeight: 600,
                                    background: cp.detourMinutes <= 20 ? 'var(--teal-2)' : 'var(--gold-2)',
                                    color: cp.detourMinutes <= 20 ? 'var(--teal-9)' : 'var(--gold-9)',
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                  }}
                                >
                                  {detourText}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Right: Vertical Column (Navigation Arrow, Edit, Trash) */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 20 }}>
                            <Navigation
                              size={14}
                              style={{
                                color: isSelected ? cp.color : 'var(--slate-8)',
                                transform: isSelected ? 'rotate(45deg)' : 'none',
                                transition: 'transform 0.2s ease, color 0.2s ease',
                              }}
                            />

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenModifyCarpool(cp);
                              }}
                              style={{
                                border: 'none',
                                background: 'none',
                                color: 'var(--slate-9)',
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              title="Edit carpool"
                            >
                              <Edit2 size={12} />
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteCarpool(cp, cpIdx);
                              }}
                              style={{
                                border: 'none',
                                background: 'none',
                                color: 'var(--slate-8)',
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                              title="Delete carpool"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {/* 2. Solo Plotted Responders */}
                    {filteredOverviewItems.solo.map((mm) => {
                      const route = memberRoutes[mm.memberId];
                      const isSelected = selectedMemberIds.includes(mm.memberId);
                      const hasAnySelection = selectedMemberIds.length > 0 || selectedCarpoolIds.length > 0;
                      const isDimmed = hasAnySelection && !isSelected;

                      return (
                        <div
                          key={mm.memberId}
                          onClick={() => handleSoloMemberClick(mm)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: isSelected ? 'var(--navy-1)' : 'var(--slate-1)',
                            border: isSelected ? `2px solid ${mm.color}` : '1px solid var(--slate-3)',
                            opacity: isDimmed ? 0.45 : 1,
                            filter: isDimmed ? 'grayscale(20%)' : 'none',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                          className="hover-card-item"
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              minWidth: 32,
                              borderRadius: '50%',
                              background: mm.color,
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                              fontSize: '11px',
                              letterSpacing: '-0.02em',
                              boxShadow: isSelected ? `0 0 0 2px #061B44, 0 3px 8px rgba(0,0,0,0.3)` : '0 2px 6px rgba(0,0,0,0.15)',
                              transition: 'box-shadow 0.2s ease',
                            }}
                          >
                            {mm.initials}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-12)' }}>
                                {mm.name}
                              </span>
                              <Navigation
                                size={13}
                                style={{
                                  color: isSelected ? mm.color : 'var(--slate-8)',
                                  transform: isSelected ? 'rotate(45deg)' : 'none',
                                  transition: 'transform 0.2s ease, color 0.2s ease',
                                }}
                              />
                            </div>

                            {route && !isCalculatingRoutes ? (
                              <div style={{ fontSize: '0.8125rem', marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span style={{ fontWeight: 600, color: 'var(--slate-12)' }}>
                                  {route.durationFormatted}
                                </span>
                                <span style={{ fontWeight: 400, color: 'var(--slate-10)', fontSize: '0.75rem' }}>
                                  ({route.distanceFormatted})
                                </span>
                              </div>
                            ) : isCalculatingRoutes || (!route && mapboxToken && actLat != null && actLng != null) ? (
                              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <div className="skeleton" style={{ width: 52, height: 13, borderRadius: 4 }} />
                                <div className="skeleton" style={{ width: 44, height: 13, borderRadius: 4 }} />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {/* 3. Unmapped Responders (No known coordinates) */}
                    {filteredOverviewItems.unmapped.map((um) => {
                      const hasAnySelection = selectedMemberIds.length > 0 || selectedCarpoolIds.length > 0;

                      return (
                        <div
                          key={um.memberId}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 8,
                            background: 'var(--slate-1)',
                            border: '1px solid var(--slate-3)',
                            opacity: hasAnySelection ? 0.45 : 1,
                            filter: hasAnySelection ? 'grayscale(20%)' : 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              minWidth: 32,
                              borderRadius: '50%',
                              background: um.color,
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                              fontSize: '11px',
                              letterSpacing: '-0.02em',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                            }}
                          >
                            {um.initials}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-12)', display: 'block' }}>
                              {um.name}
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--slate-9)' }}>
                              {um.reason || 'No known location'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}

          {/* ── MODE 2: CARPOOL SUGGESTIONS ────────────────────── */}
          {viewMode === 'suggestions' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--slate-3)', paddingBottom: 6 }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-12)' }}>
                  Suggestions ({suggestedCarpools.length})
                </span>
              </div>

              {/* Tuning Parameters */}
              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--slate-1)',
                  border: '1px solid var(--slate-3)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--slate-11)' }}>
                    Max Detour Threshold:
                  </span>
                  <select
                    value={maxDetourMinutes}
                    onChange={(e) => setMaxDetourMinutes(Number(e.target.value))}
                    style={{
                      background: 'white',
                      border: '1px solid var(--slate-4)',
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--slate-12)',
                    }}
                  >
                    <option value={15}>15 mins</option>
                    <option value={30}>30 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={60}>60 mins</option>
                    <option value={90}>90 mins</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--slate-11)' }}>
                    Vehicle Capacity:
                  </span>
                  <select
                    value={vehicleCapacity}
                    onChange={(e) => setVehicleCapacity(Number(e.target.value))}
                    style={{
                      background: 'white',
                      border: '1px solid var(--slate-4)',
                      borderRadius: 6,
                      padding: '2px 6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'var(--slate-12)',
                    }}
                  >
                    <option value={2}>2 seats</option>
                    <option value={3}>3 seats</option>
                    <option value={4}>4 seats</option>
                    <option value={5}>5 seats</option>
                    <option value={7}>7 seats</option>
                  </select>
                </div>
              </div>

              {suggestedCarpools.length === 0 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--slate-8)', padding: '12px 0', textAlign: 'center' }}>
                  No suggested carpools for remaining unassigned members.
                </div>
              )}

              {suggestedCarpools.map((cp) => {
                const isSelected = selectedCarpoolIds.includes(cp.id);
                const driver = plottedMembers.find((m) => m.memberId === cp.driverId);
                const passengers = cp.passengerIds
                  .map((id) => plottedMembers.find((m) => m.memberId === id))
                  .filter((m): m is PlottedMember => !!m);

                const allNames = [driver?.name || cp.name, ...passengers.map((p) => p.name)].join(', ');
                const hasUnmapped = cp.passengerIds.some((id) => unmappedMembers.some((u) => u.memberId === id));
                const detourText = hasUnmapped ? `${cp.detourMinutes}m+ detour` : `${cp.detourMinutes}m detour`;
                const isCalculating = isCalculatingCarpools || isCalculatingRoutes;

                return (
                  <div
                    key={cp.id}
                    onClick={() => handleCarpoolClick(cp)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: isSelected ? 'var(--navy-1)' : 'var(--slate-1)',
                      border: isSelected ? `2px solid ${cp.color}` : '1px solid var(--slate-3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    className="hover-card-item"
                  >
                    {/* Top Row: Avatar Stack + Content + Navigation Arrow */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      {/* Left: Avatar Stack with Passenger Icons Peeping at the Bottom */}
                      <div
                        style={{
                          position: 'relative',
                          width: 32,
                          minWidth: 32,
                          height: Math.max(34, 32 + passengers.length * 8),
                          marginTop: 2,
                        }}
                      >
                        {/* Passenger Avatars peeping below */}
                        {passengers.map((passenger, pIdx) => (
                          <div
                            key={passenger.memberId}
                            style={{
                              position: 'absolute',
                              top: 10 + (pIdx + 1) * 8,
                              left: 2,
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              background: passenger.color,
                              color: '#ffffff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 600,
                              fontSize: '9px',
                              letterSpacing: '-0.02em',
                              border: '2px solid #ffffff',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                              zIndex: Math.max(1, 8 - pIdx),
                            }}
                            title={`Passenger: ${passenger.name}`}
                          >
                            {passenger.initials}
                          </div>
                        ))}

                        {/* Driver Avatar on Top */}
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: cp.color,
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            fontSize: '11px',
                            letterSpacing: '-0.02em',
                            border: '2px solid #ffffff',
                            boxShadow: isSelected
                              ? `0 0 0 2px #061B44, 0 3px 8px rgba(0,0,0,0.3)`
                              : '0 2px 6px rgba(0,0,0,0.15)',
                            zIndex: 10,
                          }}
                          title={`Driver: ${driver?.name || 'Driver'}`}
                        >
                          {driver?.initials || 'DR'}
                        </div>
                      </div>

                      {/* Middle: Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--slate-12)', display: 'block', lineHeight: 1.35 }}>
                          {allNames}
                        </span>

                        {/* Travel Time, Distance & Detour (with skeleton shimmer while calculating) */}
                        {isCalculating ? (
                          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div className="skeleton" style={{ width: 52, height: 13, borderRadius: 4 }} />
                            <div className="skeleton" style={{ width: 44, height: 13, borderRadius: 4 }} />
                            <div className="skeleton" style={{ width: 58, height: 16, borderRadius: 4 }} />
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8125rem', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 600, color: 'var(--slate-12)' }}>
                              {cp.durationFormatted}
                            </span>
                            <span style={{ fontWeight: 400, color: 'var(--slate-10)', fontSize: '0.75rem' }}>
                              ({cp.distanceFormatted})
                            </span>
                            <span
                              style={{
                                fontSize: '0.6875rem',
                                fontWeight: 600,
                                background: cp.detourMinutes <= 20 ? 'var(--teal-2)' : 'var(--gold-2)',
                                color: cp.detourMinutes <= 20 ? 'var(--teal-9)' : 'var(--gold-9)',
                                padding: '1px 5px',
                                borderRadius: 4,
                              }}
                            >
                              {detourText}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right: Selection Navigation Arrow */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 20 }}>
                        <Navigation
                          size={14}
                          style={{
                            color: isSelected ? cp.color : 'var(--slate-8)',
                            transform: isSelected ? 'rotate(45deg)' : 'none',
                            transition: 'transform 0.2s ease, color 0.2s ease',
                          }}
                        />
                      </div>
                    </div>

                    {/* Expanded Bottom Action Row (Only shown when suggestion is selected) */}
                    {isSelected && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 6,
                          marginTop: 8,
                          paddingTop: 8,
                          borderTop: '1px solid var(--slate-3)',
                        }}
                      >
                        {/* Edit Button: Icon only */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenModifyCarpool(cp);
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{
                            fontSize: '0.75rem',
                            padding: '3px 8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: 26,
                          }}
                          title="Modify carpool suggestion"
                        >
                          <Edit2 size={12} />
                        </button>

                        {/* Accept Button: Icon and Text */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAcceptCarpool(cp);
                          }}
                          className="btn btn-primary btn-sm"
                          style={{
                            fontSize: '0.75rem',
                            padding: '3px 10px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            background: 'var(--teal-9)',
                            borderColor: 'var(--teal-9)',
                            color: '#ffffff',
                            height: 26,
                            fontWeight: 600,
                          }}
                          title="Accept suggestion into overview carpools"
                        >
                          <Check size={12} strokeWidth={2.5} />
                          <span>Accept</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Add / Modify Carpool Modal ────────────────────── */}
      {isCreatingCarpool && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(6,27,68,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            className="card animate-fade-in"
            style={{
              width: '100%',
              maxWidth: 480,
              padding: '24px',
              borderRadius: 12,
              background: 'white',
              boxShadow: '0 12px 36px rgba(0,0,0,0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--slate-3)', paddingBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Car size={18} style={{ color: 'var(--navy-9)' }} />
                <span style={{ fontWeight: 600, fontSize: '1.0625rem', color: 'var(--slate-12)' }}>
                  {editingCarpoolId ? 'Modify Carpool' : 'Create Carpool'}
                </span>
              </div>
              <button
                onClick={() => {
                  setIsCreatingCarpool(false);
                  setEditingCarpoolId(null);
                }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--slate-9)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Select Driver */}
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-12)', marginBottom: 6 }}>
                1. Select Driver (Vehicle Origin)
              </label>
              <select
                value={newDriverId || ''}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setNewDriverId(id);
                  setNewPassengerIds((prev) => prev.filter((pId) => pId !== id));
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--slate-4)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--slate-12)',
                  background: 'white',
                }}
              >
                <option value="">-- Choose a Driver --</option>
                {modalAvailableMembers.drivers.map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name} {m.addressText ? `(${m.addressText})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Select Pickups (Mapped & Unmapped Members) */}
            {newDriverId && (
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--slate-12)', marginBottom: 6 }}>
                  2. Select Passengers to Pick Up ({newPassengerIds.length} selected)
                </label>
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    border: '1px solid var(--slate-3)',
                    borderRadius: 6,
                    padding: 8,
                  }}
                >
                  {/* Mapped Passengers */}
                  {modalAvailableMembers.passengersMapped
                    .filter((m) => m.memberId !== newDriverId)
                    .map((m) => {
                      const isChecked = newPassengerIds.includes(m.memberId);

                      return (
                        <label
                          key={m.memberId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '6px 8px',
                            borderRadius: 4,
                            background: isChecked ? 'var(--navy-1)' : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewPassengerIds((prev) => [...prev, m.memberId]);
                              } else {
                                setNewPassengerIds((prev) => prev.filter((id) => id !== m.memberId));
                              }
                            }}
                          />
                          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-12)' }}>
                            {m.name} {m.addressText ? `(${m.addressText})` : ''}
                          </span>
                        </label>
                      );
                    })}

                  {/* Unmapped Passengers */}
                  {modalAvailableMembers.passengersUnmapped.map((u) => {
                    const isChecked = newPassengerIds.includes(u.memberId);

                    return (
                      <label
                        key={u.memberId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 8px',
                          borderRadius: 4,
                          background: isChecked ? 'var(--navy-1)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewPassengerIds((prev) => [...prev, u.memberId]);
                            } else {
                              setNewPassengerIds((prev) => prev.filter((id) => id !== u.memberId));
                            }
                          }}
                        />
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--slate-12)' }}>
                          {u.name} <span style={{ color: 'var(--slate-9)', fontSize: '0.75rem' }}>(No location, +0m detour)</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--slate-3)', paddingTop: 14 }}>
              <button
                onClick={() => {
                  setIsCreatingCarpool(false);
                  setEditingCarpoolId(null);
                }}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveManualCarpool}
                disabled={!newDriverId || newPassengerIds.length === 0 || isSavingCarpool}
                className="btn btn-primary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {isSavingCarpool ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                <span>Save Carpool ({1 + newPassengerIds.length} people)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shadcn UI Styled Alert Toast for Deleted Carpool with Undo ── */}
      {deletedCarpoolNotice && (
        <div
          className="animate-slide-up no-print"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            background: 'var(--slate-12)',
            color: '#ffffff',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.25), 0 8px 10px -6px rgba(0,0,0,0.2)',
            border: '1px solid var(--slate-10)',
            fontSize: '0.8125rem',
            fontWeight: 500,
            maxWidth: 380,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <Trash2 size={14} style={{ color: 'var(--slate-7)', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {deletedCarpoolNotice.label} deleted
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleUndoDeleteCarpool}
              style={{
                border: 'none',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: 'background 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
            >
              <RotateCcw size={11} />
              <span>Undo</span>
            </button>

            <button
              onClick={() => {
                if (deleteNoticeTimerRef.current) clearTimeout(deleteNoticeTimerRef.current);
                setDeletedCarpoolNotice(null);
              }}
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--slate-7)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Shadcn UI Styled Alert Toast for Accepted Carpool ── */}
      {acceptedCarpoolNotice && (
        <div
          className="animate-slide-up no-print"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            background: 'var(--slate-12)',
            color: '#ffffff',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.25), 0 8px 10px -6px rgba(0,0,0,0.2)',
            border: '1px solid var(--slate-10)',
            fontSize: '0.8125rem',
            fontWeight: 500,
            maxWidth: 420,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <Check size={15} style={{ color: '#34d399', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {acceptedCarpoolNotice.title}
              </span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--slate-7)' }}>
                {acceptedCarpoolNotice.message || 'View this carpool in the Overview tab'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => {
                if (acceptNoticeTimerRef.current) clearTimeout(acceptNoticeTimerRef.current);
                setAcceptedCarpoolNotice(null);
              }}
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--slate-7)',
                cursor: 'pointer',
                padding: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

