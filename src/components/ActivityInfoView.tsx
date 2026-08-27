import React from 'react';
import { useNavigate } from 'react-router-dom';
import { isSameDay, isToday, isTomorrow, differenceInMinutes, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  Info,
  MapPin,
  Shield,
  Users,
} from 'lucide-react';
import type { Activity, Attendee, Member, UserPermissions, AdjacentOpPeriodsResult } from '../api/d4h';
import {
  canUserRespondToActivity,
  formatActivityLocation,
  getActivityStreetAddress,
  getCurrentUserPermissions,
  getMemberDetails,
  getMemberImageUrl,
  getMemberLocationQuery,
  getSynchronousMember,
  getSynchronousMemberImageUrl,
  getUserAttendanceForActivity,
  isMemberOutOfStateOrCountry,
  getAdjacentOpPeriods,
} from '../api/d4h';
import {
  calculateDistanceMiles,
  formatDrivingDuration,
  geocodeAddress,
  getDrivingRoute,
  getMapboxToken,
  getSynchronousDrivingRoute,
  getSynchronousGeocode,
  isDrivingRouteCached,
  MAX_REASONABLE_DISTANCE_MILES,
} from '../api/mapbox';
import { ActivityMiniMap } from './ActivityMiniMap';
import { ActivityWeatherConditions } from './ActivityWeatherConditions';
import { cleanDescription } from './ActivityPopover';
import { MemberPopover } from './MemberPopover';
import { ActivityAttachmentsCard } from './ActivityAttachmentsCard';
import { ActivityStatusBadges } from './ActivityStatusBadges';

interface ActivityInfoViewProps {
  activity: Activity | null;
  activityType?: string;
  activityName?: string;
  teamTitle?: string;
  attendees: Attendee[];
  members: Member[];
  medicalMap?: Record<number, string>;
  technicalMap?: Record<number, string>;
  isLocal?: boolean;
  onSwitchToRoster?: () => void;
  onSwitchToMap: () => void;
  onAttendanceChanged?: () => void;
}

const MemberTileAvatar: React.FC<{
  contextId: number;
  memberId?: number;
  name: string;
  isReadyToLoadPictures?: boolean;
}> = ({ contextId, memberId, name, isReadyToLoadPictures = true }) => {
  const [imgUrl, setImgUrl] = React.useState<string | null>(() => {
    return memberId ? getSynchronousMemberImageUrl(contextId, memberId) : null;
  });
  const [loaded, setLoaded] = React.useState<boolean>(() => {
    return memberId ? !!getSynchronousMemberImageUrl(contextId, memberId) : false;
  });

  React.useEffect(() => {
    let isCancelled = false;
    if (!isReadyToLoadPictures || !contextId || !memberId) return;

    // Defer network image request so main thread and attendee names resolve first
    const timer = setTimeout(() => {
      getMemberImageUrl(contextId, memberId).then((url) => {
        if (!isCancelled && url) {
          setImgUrl(url);
        }
      });
    }, 60);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [contextId, memberId, isReadyToLoadPictures]);

  const initials = React.useMemo(() => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [name]);

  return (
    <div
      style={{
        width: 64,
        height: 64,
        minWidth: 64,
        minHeight: 64,
        maxWidth: 64,
        maxHeight: 64,
        position: 'relative',
        background: 'var(--slate-3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderTopLeftRadius: 9,
        borderBottomLeftRadius: 9,
        flexShrink: 0,
      }}
    >
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={name}
          onLoad={() => setLoaded(true)}
          style={{
            width: 64,
            height: 64,
            objectFit: 'cover',
            display: 'block',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
        />
      ) : null}

      {(!imgUrl || !loaded) && (
        !name || name === 'Responding Member' ? (
          <div className="skeleton" style={{ width: '100%', height: '100%' }} />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--slate-4)',
              color: 'var(--slate-10)',
              fontWeight: 700,
              fontSize: '0.9375rem',
              letterSpacing: '-0.02em',
            }}
          >
            {initials}
          </div>
        )
      )}
    </div>
  );
};

export const ActivityInfoView: React.FC<ActivityInfoViewProps> = ({
  activity,
  activityType,
  attendees,
  members,
  medicalMap,
  technicalMap,
  isLocal = false,
  onSwitchToMap,
  onAttendanceChanged,
}) => {
  const navigate = useNavigate();
  const contextIdStr = localStorage.getItem('d4h_context_id');
  const contextId = contextIdStr ? parseInt(contextIdStr, 10) : 0;
  const cachedMemberIdStr = localStorage.getItem('d4h_member_id');
  const cachedMemberId = cachedMemberIdStr ? parseInt(cachedMemberIdStr, 10) : null;

  const [adjacentOps, setAdjacentOps] = React.useState<AdjacentOpPeriodsResult>({
    yesterdayActivity: null,
    tomorrowActivity: null,
    hasYesterdayOp: false,
    hasTomorrowOp: false,
    isMultiDaySpanning: false,
  });

  React.useEffect(() => {
    let isMounted = true;
    if (!contextId || !activity || isLocal) return;

    getAdjacentOpPeriods(contextId, activity).then((res) => {
      if (isMounted) {
        setAdjacentOps(res);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [contextId, activity, isLocal]);

  const [userPermissions, setUserPermissions] = React.useState<UserPermissions>({
    canUpdateOwnAttendance: false,
    canCreateAttendance: false,
    canUpdateAllAttendance: false,
    canUpdateExercise: false,
    canUpdateIncident: false,
    canUpdateEvent: false,
    memberId: cachedMemberId,
  });
  const [userAttendance, setUserAttendance] = React.useState<Attendee | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    if (isLocal || !contextId || !activity?.id) {
      if (cachedMemberId) {
        setUserPermissions((prev) => ({ ...prev, memberId: cachedMemberId }));
      }
      return;
    }

    getCurrentUserPermissions(contextId).then((perms) => {
      if (!isMounted) return;
      setUserPermissions(perms);

      const effectiveMemberId = perms.memberId || cachedMemberId;
      if (effectiveMemberId && activity.id) {
        getUserAttendanceForActivity(contextId, activity.id, effectiveMemberId).then((att) => {
          if (isMounted) setUserAttendance(att);
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [contextId, activity?.id, isLocal, cachedMemberId]);

  const startDate = activity?.startsAt ? new Date(activity.startsAt) : new Date();
  const endDate = activity?.endsAt ? new Date(activity.endsAt) : startDate;
  const isMultiDay = !isNaN(startDate.getTime()) && !isNaN(endDate.getTime()) && !isSameDay(startDate, endDate);

  // Duration in hours
  let durationHours = 0;
  if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
    const mins = Math.max(0, differenceInMinutes(endDate, startDate));
    durationHours = parseFloat((mins / 60).toFixed(1));
  }

  const streetAddress = getActivityStreetAddress(activity || undefined);
  const locationText = formatActivityLocation(activity || undefined);

  let lat: number | null = null;
  let lng: number | null = null;
  if (
    activity?.location?.coordinates &&
    Array.isArray(activity.location.coordinates) &&
    activity.location.coordinates.length >= 2
  ) {
    const [coordLng, coordLat] = activity.location.coordinates;
    if (coordLat !== 0 || coordLng !== 0) {
      lat = coordLat;
      lng = coordLng;
    }
  }

  const effectiveMemberId = userPermissions.memberId || cachedMemberId;
  const isPast = (activity?.endsAt ? new Date(activity.endsAt) : startDate) < new Date();

  const canRespond = React.useMemo(() => {
    return canUserRespondToActivity({
      isLocal,
      isPast,
      contextId,
      activityId: activity?.id,
      activityType: activityType || activity?.type,
      userPermissions,
      userAttendance,
      attendees,
      effectiveMemberId,
    });
  }, [
    isLocal,
    isPast,
    contextId,
    activity?.id,
    activityType,
    activity?.type,
    userPermissions,
    userAttendance,
    attendees,
    effectiveMemberId,
  ]);

  const [currentUserMember, setCurrentUserMember] = React.useState<Member | null>(() => {
    if (!effectiveMemberId) return null;
    const found = members.find((m) => m.id === effectiveMemberId);
    if (found) return found;
    return contextId ? getSynchronousMember(contextId, effectiveMemberId) : null;
  });

  React.useEffect(() => {
    if (!effectiveMemberId) {
      setCurrentUserMember(null);
      return;
    }
    const found = members.find((m) => m.id === effectiveMemberId);
    if (found) {
      setCurrentUserMember(found);
      return;
    }
    if (contextId) {
      const syncMem = getSynchronousMember(contextId, effectiveMemberId);
      if (syncMem) {
        setCurrentUserMember(syncMem);
        return;
      }
      getMemberDetails(contextId, [effectiveMemberId]).then((res) => {
        if (res && res.length > 0) {
          setCurrentUserMember(res[0]);
        }
      });
    }
  }, [members, effectiveMemberId, contextId]);

  const currentMember = currentUserMember;

  const fullActivityAddress = React.useMemo(() => {
    return (
      getActivityStreetAddress(activity || undefined) ||
      formatActivityLocation(activity || undefined)
    );
  }, [activity]);

  const isEventTodayOrTomorrow = React.useMemo(() => {
    if (!activity?.startsAt) return false;
    const start = new Date(activity.startsAt);
    if (isNaN(start.getTime())) return false;
    if (isToday(start) || isTomorrow(start)) return true;
    if (activity.endsAt) {
      const end = new Date(activity.endsAt);
      if (!isNaN(end.getTime()) && start <= new Date() && end >= new Date()) {
        return true;
      }
    }
    return false;
  }, [activity?.startsAt, activity?.endsAt]);

  const formatDrivingTimeSummary = React.useCallback(
    (trafficSec?: number | null, baselineSec?: number | null): string | null => {
      if (trafficSec != null && baselineSec != null) {
        const trafficMin = Math.round(trafficSec / 60);
        const baselineMin = Math.round(baselineSec / 60);
        const diffMin = Math.abs(trafficMin - baselineMin);
        if (diffMin >= 30) {
          return `(${formatDrivingDuration(trafficSec)} from home now, typically ${formatDrivingDuration(baselineSec)})`;
        }
        return `(${formatDrivingDuration(trafficSec)} from home)`;
      }
      if (trafficSec != null) {
        return `(${formatDrivingDuration(trafficSec)} from home)`;
      }
      if (baselineSec != null) {
        return `(${formatDrivingDuration(baselineSec)} from home)`;
      }
      return null;
    },
    []
  );

  const [drivingTimeText, setDrivingTimeText] = React.useState<string | null>(() => {
    if (!canRespond || !currentMember || isMemberOutOfStateOrCountry(currentMember)) return null;

    let destLat = lat;
    let destLng = lng;
    if (fullActivityAddress) {
      const syncDest = getSynchronousGeocode(fullActivityAddress);
      if (syncDest) {
        destLat = syncDest.lat;
        destLng = syncDest.lng;
      }
    }
    if (destLat == null || destLng == null) return null;

    let origLat: number | null = null;
    let origLng: number | null = null;
    if (
      currentMember.location?.coordinates &&
      Array.isArray(currentMember.location.coordinates) &&
      currentMember.location.coordinates.length >= 2
    ) {
      const [lngVal, latVal] = currentMember.location.coordinates;
      if (latVal !== 0 || lngVal !== 0) {
        origLat = latVal;
        origLng = lngVal;
      }
    }
    if (origLat == null || origLng == null) {
      const userAddr = getMemberLocationQuery(currentMember);
      if (userAddr) {
        const syncOrig = getSynchronousGeocode(userAddr);
        if (syncOrig) {
          origLat = syncOrig.lat;
          origLng = syncOrig.lng;
        }
      }
    }
    if (origLat == null || origLng == null) return null;

    if (calculateDistanceMiles(origLat, origLng, destLat, destLng) > MAX_REASONABLE_DISTANCE_MILES) {
      return null;
    }

    const syncBaseline = getSynchronousDrivingRoute(
      { lng: origLng, lat: origLat },
      { lng: destLng, lat: destLat },
      { profile: 'driving', departureKey: 'baseline' }
    );
    const syncTraffic = isEventTodayOrTomorrow
      ? getSynchronousDrivingRoute(
        { lng: origLng, lat: origLat },
        { lng: destLng, lat: destLat },
        { profile: 'driving-traffic', departAt: 'now', departureKey: 'now' }
      )
      : null;

    return formatDrivingTimeSummary(syncTraffic?.durationSeconds, syncBaseline?.durationSeconds);
  });

  const [isLoadingDrivingTime, setIsLoadingDrivingTime] = React.useState<boolean>(false);

  React.useEffect(() => {
    let isCancelled = false;
    const token = getMapboxToken();

    if (!canRespond || !currentMember || isMemberOutOfStateOrCountry(currentMember) || !token) {
      setDrivingTimeText(null);
      setIsLoadingDrivingTime(false);
      return;
    }

    const computeDrivingTime = async () => {
      // 1. Destination coordinates
      let destCoords: { lat: number; lng: number } | null = null;
      if (fullActivityAddress) {
        const cached = getSynchronousGeocode(fullActivityAddress);
        if (cached) {
          destCoords = { lat: cached.lat, lng: cached.lng };
        } else {
          const res = await geocodeAddress(fullActivityAddress, token);
          if (isCancelled) return;
          if (res) {
            destCoords = { lat: res.lat, lng: res.lng };
          }
        }
      }

      if (!destCoords && lat != null && lng != null) {
        destCoords = { lat, lng };
      }

      if (!destCoords) {
        if (!isCancelled) {
          setDrivingTimeText(null);
          setIsLoadingDrivingTime(false);
        }
        return;
      }

      // 2. Origin coordinates
      let originCoords: { lat: number; lng: number } | null = null;
      if (
        currentMember.location?.coordinates &&
        Array.isArray(currentMember.location.coordinates) &&
        currentMember.location.coordinates.length >= 2
      ) {
        const [mCoordLng, mCoordLat] = currentMember.location.coordinates;
        if (mCoordLat !== 0 || mCoordLng !== 0) {
          originCoords = { lat: mCoordLat, lng: mCoordLng };
        }
      }

      if (!originCoords) {
        const userAddr = getMemberLocationQuery(currentMember);
        if (userAddr) {
          const cached = getSynchronousGeocode(userAddr);
          if (cached) {
            originCoords = { lat: cached.lat, lng: cached.lng };
          } else {
            const res = await geocodeAddress(userAddr, token);
            if (isCancelled) return;
            if (res) {
              originCoords = { lat: res.lat, lng: res.lng };
            }
          }
        }
      }

      if (!originCoords) {
        if (!isCancelled) {
          setDrivingTimeText(null);
          setIsLoadingDrivingTime(false);
        }
        return;
      }

      // 3. Distance check
      if (
        calculateDistanceMiles(originCoords.lat, originCoords.lng, destCoords.lat, destCoords.lng) >
        MAX_REASONABLE_DISTANCE_MILES
      ) {
        if (!isCancelled) {
          setDrivingTimeText(null);
          setIsLoadingDrivingTime(false);
        }
        return;
      }

      // 4. Check cache for zero-flicker
      const isBaselineCached = isDrivingRouteCached(originCoords, destCoords, {
        profile: 'driving',
        departureKey: 'baseline',
      });
      const isTrafficCached = !isEventTodayOrTomorrow || isDrivingRouteCached(originCoords, destCoords, {
        profile: 'driving-traffic',
        departAt: 'now',
        departureKey: 'now',
      });

      if (!isBaselineCached || !isTrafficCached) {
        setIsLoadingDrivingTime(true);
      }

      // 5. Query driving routes in parallel (only fetch traffic route if event is today or tomorrow)
      const [baselineRoute, trafficRoute] = await Promise.all([
        getDrivingRoute(originCoords, destCoords, {
          profile: 'driving',
          departureKey: 'baseline',
          customToken: token,
        }),
        isEventTodayOrTomorrow
          ? getDrivingRoute(originCoords, destCoords, {
            profile: 'driving-traffic',
            departAt: 'now',
            departureKey: 'now',
            customToken: token,
          })
          : Promise.resolve(null),
      ]);

      if (isCancelled) return;

      const summary = formatDrivingTimeSummary(
        trafficRoute?.durationSeconds,
        baselineRoute?.durationSeconds
      );
      setDrivingTimeText(summary);
      setIsLoadingDrivingTime(false);
    };

    computeDrivingTime();

    return () => {
      isCancelled = true;
    };
  }, [canRespond, currentMember, fullActivityAddress, lat, lng, isEventTodayOrTomorrow, formatDrivingTimeSummary]);

  const cleanedDesc = cleanDescription(activity?.description);
  const rawPrePlan = (activity as any)?.prePlan || (activity as any)?.pre_plan || (activity as any)?.plan || (activity as any)?.preplan || (activity as any)?.prePlanning || (activity as any)?.pre_planning;
  const cleanedPrePlan = cleanDescription(rawPrePlan);

  const uniqueMemberIds = React.useMemo(() => {
    return new Set(attendees.map((a) => a.member?.id).filter(Boolean));
  }, [attendees]);

  const isMultiPeriod = React.useMemo(() => {
    const start = activity?.startsAt || (activity as any)?.startDate;
    const end = activity?.endsAt || (activity as any)?.endDate;
    if (start && end) {
      try {
        const d1 = new Date(start);
        const d2 = new Date(end);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && !isSameDay(d1, d2)) {
          return true;
        }
      } catch { }
    }

    const dates = new Set<string>();
    attendees.forEach((a) => {
      if (a.startsAt) {
        try {
          const d = new Date(a.startsAt);
          if (!isNaN(d.getTime())) dates.add(format(d, 'yyyy-MM-dd'));
        } catch { }
      }
    });
    return dates.size > 1;
  }, [activity, attendees]);

  const displayedAttendees = React.useMemo(() => {
    const memberMapById = new Map<number, {
      primaryAtt: Attendee;
      allAtts: Attendee[];
      earliestStartsAt?: string;
      latestEndsAt?: string;
      allOpDates: string[];
    }>();

    attendees.forEach((att) => {
      const memberId = att.member?.id;
      if (!memberId) return;

      let opDate: string | undefined;
      if (att.startsAt) {
        try {
          const d = new Date(att.startsAt);
          if (!isNaN(d.getTime())) {
            opDate = format(d, 'yyyy-MM-dd');
          }
        } catch { }
      }

      if (!memberMapById.has(memberId)) {
        memberMapById.set(memberId, {
          primaryAtt: att,
          allAtts: [att],
          earliestStartsAt: att.startsAt,
          latestEndsAt: att.endsAt,
          allOpDates: opDate ? [opDate] : [],
        });
      } else {
        const entry = memberMapById.get(memberId)!;
        entry.allAtts.push(att);
        if (opDate && !entry.allOpDates.includes(opDate)) {
          entry.allOpDates.push(opDate);
        }
        if (att.startsAt && (!entry.earliestStartsAt || new Date(att.startsAt) < new Date(entry.earliestStartsAt))) {
          entry.earliestStartsAt = att.startsAt;
        }
        if (att.endsAt && (!entry.latestEndsAt || new Date(att.endsAt) > new Date(entry.latestEndsAt))) {
          entry.latestEndsAt = att.endsAt;
        }
      }
    });

    return Array.from(memberMapById.values()).map((entry) => ({
      ...entry.primaryAtt,
      startsAt: entry.earliestStartsAt,
      endsAt: entry.latestEndsAt,
      _shiftsCount: entry.allAtts.length,
      _allOpDates: entry.allOpDates,
    }));
  }, [attendees]);

  // Map member lookup
  const memberMap = new Map<number, Member>();
  members.forEach((m) => memberMap.set(m.id, m));

  const isReadyToLoadPictures = attendees.length > 0 && members.length > 0;
  const [isDescExpanded, setIsDescExpanded] = React.useState(false);
  const [isPrePlanExpanded, setIsPrePlanExpanded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'description' | 'preplan'>('description');

  const renderDateAndConditionsCard = (animIdx = 2) => (
    <div
      className="card activity-info-card animate-slide-up w-full order-2 lg:order-none"
      style={{
        padding: '22px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        animationDelay: `${animIdx * 50}ms`,
        animationFillMode: 'both',
      }}
    >
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--slate-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} style={{ color: 'var(--navy-7)' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
            Date &amp; Conditions
          </h2>
        </div>
        {lat != null && lng != null && (
          <a
            href={`https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            title="View full NOAA NWS forecast"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--slate-11)',
              textDecoration: 'none',
              padding: '3px 8px',
              borderRadius: 6,
              border: '1px solid var(--slate-6)',
              background: 'transparent',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--slate-3)';
              e.currentTarget.style.color = 'var(--slate-12)';
              e.currentTarget.style.borderColor = 'var(--slate-8)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--slate-11)';
              e.currentTarget.style.borderColor = 'var(--slate-6)';
            }}
          >
            <ExternalLink size={11} />
            NOAA
          </a>
        )}
      </div>

      {/* NOAA Field Safety Weather & Duration Tiles */}
      <ActivityWeatherConditions
        lat={lat}
        lng={lng}
        startDate={startDate}
        endDate={endDate}
        durationHours={durationHours}
        isMultiDay={isMultiDay}
      />
    </div>
  );

  const renderLocationCard = (animIdx = 1) => {
    const altLocation = !streetAddress && (activity?.address?.town || activity?.address?.street)
      ? [activity?.address?.street, activity?.address?.town].filter(Boolean).join(', ')
      : '';

    return (
      <div
        className="card activity-info-card animate-slide-up w-full order-3 lg:order-none"
        style={{
          padding: '22px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          animationDelay: `${animIdx * 50}ms`,
          animationFillMode: 'both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--slate-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MapPin size={18} style={{ color: 'var(--navy-7)' }} />
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
              Location
            </h2>
          </div>
          {lat != null && lng != null && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSwitchToMap}
              className="h-7 px-2.5 text-xs font-semibold"
            >
              Expand Map
            </Button>
          )}
        </div>

        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--slate-12)' }}>
            {streetAddress ? (
              streetAddress
            ) : lat != null && lng != null ? (
              `${lat.toFixed(5)}, ${lng.toFixed(5)}`
            ) : (
              locationText || 'No specific location provided'
            )}
          </div>
          {(altLocation || drivingTimeText || (isLoadingDrivingTime && !drivingTimeText)) && (
            <div style={{ fontSize: '0.75rem', color: 'var(--slate-10)', marginTop: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 4px' }}>
              {altLocation && <span>{altLocation}</span>}
              {isLoadingDrivingTime && !drivingTimeText && (
                <span
                  className="skeleton"
                  style={{
                    display: 'inline-block',
                    width: 90,
                    height: 12,
                    borderRadius: 4,
                    verticalAlign: 'middle',
                  }}
                />
              )}
              {!isLoadingDrivingTime && drivingTimeText && (
                <span>{drivingTimeText}</span>
              )}
            </div>
          )}
        </div>

        {/* Mini-map embed */}
        <div style={{ marginTop: 2 }}>
          <ActivityMiniMap
            lat={lat}
            lng={lng}
            locationName={locationText}
            height={140}
          />
        </div>
      </div>
    );
  };

  const renderDescriptionAndPlanCard = (animIdx = 0) => {
    const hasYesterdayOp = adjacentOps.hasYesterdayOp && Boolean(adjacentOps.yesterdayActivity);
    const hasTomorrowOp = adjacentOps.hasTomorrowOp && Boolean(adjacentOps.tomorrowActivity);
    const hasMultipleOpActivities = hasYesterdayOp || hasTomorrowOp;
    const isMultiDayActivity = adjacentOps.isMultiDaySpanning || isMultiDay || isMultiPeriod;
    const hasDesc = Boolean(cleanedDesc || hasMultipleOpActivities);
    const hasPrePlan = Boolean(cleanedPrePlan);
    const hasBothTabs = hasDesc && hasPrePlan;

    // If neither description nor pre-plan exists, hide the entire card
    if (!hasDesc && !hasPrePlan) return null;

    const now = new Date();
    const isActPast = (activity?.endsAt ? new Date(activity.endsAt) : startDate) < now;
    const isYesterdayPast = adjacentOps.yesterdayActivity?.startsAt
      ? new Date(adjacentOps.yesterdayActivity.startsAt) < now
      : isActPast;
    const isTomorrowPast = adjacentOps.tomorrowActivity?.startsAt
      ? new Date(adjacentOps.tomorrowActivity.startsAt) < now
      : isActPast;

    let opPeriodText = '';
    if (hasYesterdayOp && hasTomorrowOp) {
      if (isActPast && isTomorrowPast) {
        opPeriodText = 'There was an operational period on both the previous and following day';
      } else if (isYesterdayPast && !isTomorrowPast) {
        opPeriodText = 'There was an operational period on the previous day and there is one on the following day';
      } else {
        opPeriodText = 'There is an operational period on both the previous and following day';
      }
    } else if (hasYesterdayOp) {
      opPeriodText = isYesterdayPast
        ? 'There was an operational period on the previous day'
        : 'There is an operational period on the previous day';
    } else if (hasTomorrowOp) {
      opPeriodText = isTomorrowPast
        ? 'There was an operational period on the following day'
        : 'There is an operational period on the following day';
    } else if (isMultiDayActivity) {
      opPeriodText = isActPast
        ? 'This activity spanned multiple days'
        : 'This activity spans multiple days';
    }

    const hasMultiOpNotice = Boolean(opPeriodText);
    const isLongDesc = Boolean(cleanedDesc && (cleanedDesc.split('\n').length > 5 || cleanedDesc.length > 280));
    const isLongPrePlan = Boolean(cleanedPrePlan && (cleanedPrePlan.split('\n').length > 5 || cleanedPrePlan.length > 280));

    const showingDescTab = hasBothTabs ? activeTab === 'description' : hasDesc;

    // Render operational period footer (full length separator flush with bottom of the card)
    const renderOpPeriodFooter = () => {
      if (!hasMultiOpNotice) return null;
      return (
        <div className="-mx-4 sm:-mx-[26px] -mb-3.5 sm:-mb-[22px] mt-4 pt-3 sm:pt-3.5 pb-3 sm:pb-3.5 px-4 sm:px-[26px] border-t border-[var(--slate-3)] bg-slate-50/70 dark:bg-slate-900/40 rounded-b-[11px]">
          <div
            className="op-period-nav-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              width: '100%',
            }}
          >
            {/* Left Slot: Previous Day button */}
            <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-start' }}>
              {hasYesterdayOp && adjacentOps.yesterdayActivity ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(`/exercise/${adjacentOps.yesterdayActivity!.id}`, {
                      state: { exercise: adjacentOps.yesterdayActivity },
                    })
                  }
                  className="h-8 px-2 sm:px-2.5 gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 shrink-0"
                  title="Navigate to previous day's operational period"
                  aria-label="Previous day operational period"
                >
                  <ArrowLeft size={14} />
                  <span className="hidden sm:inline">Previous Day</span>
                </Button>
              ) : (
                <div style={{ visibility: 'hidden', width: 32 }} aria-hidden="true" />
              )}
            </div>

            {/* Center Slot: Status text */}
            <div
              style={{
                flex: 1,
                fontSize: '0.8125rem',
                color: 'var(--slate-10)',
                fontWeight: 500,
                textAlign: 'center',
                padding: '0 4px',
                lineHeight: 1.35,
                minWidth: 0,
              }}
            >
              {opPeriodText}
            </div>

            {/* Right Slot: Next Day button */}
            <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'flex-end' }}>
              {hasTomorrowOp && adjacentOps.tomorrowActivity ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(`/exercise/${adjacentOps.tomorrowActivity!.id}`, {
                      state: { exercise: adjacentOps.tomorrowActivity },
                    })
                  }
                  className="h-8 px-2 sm:px-2.5 gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 shrink-0"
                  title="Navigate to following day's operational period"
                  aria-label="Next day operational period"
                >
                  <span className="hidden sm:inline">Next Day</span>
                  <ArrowRight size={14} />
                </Button>
              ) : (
                <div style={{ visibility: 'hidden', width: 32 }} aria-hidden="true" />
              )}
            </div>
          </div>
        </div>
      );
    };

    // ── SCENARIO A: Single content (Only Description OR Only Pre-Plan) ──
    if (!hasBothTabs) {
      const isDescOnly = hasDesc;
      const content = isDescOnly ? cleanedDesc : cleanedPrePlan;
      const isLong = isDescOnly ? isLongDesc : isLongPrePlan;
      const isExpanded = isDescOnly ? isDescExpanded : isPrePlanExpanded;
      const toggleExpand = isDescOnly
        ? () => setIsDescExpanded((prev) => !prev)
        : () => setIsPrePlanExpanded((prev) => !prev);
      const title = isDescOnly ? 'Activity Description' : 'Pre-Plan';
      const Icon = isDescOnly ? Info : ClipboardList;

      return (
        <div
          className="card activity-info-card activity-info-desc-card animate-slide-up w-full order-1 lg:order-none"
          style={{
            padding: '22px 26px',
            animationDelay: `${animIdx * 50}ms`,
            animationFillMode: 'both',
          }}
        >
          {/* Standard Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--slate-3)] mb-3.5">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={18} style={{ color: 'var(--navy-7)' }} className="shrink-0" />
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
                {title}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <ActivityStatusBadges
                activity={activity}
                activityType={activityType || activity?.type || 'exercise'}
                attendees={attendees}
                isLocal={isLocal}
                onAttendanceChanged={onAttendanceChanged}
              />
            </div>
          </div>

          {/* Standard Body (no stylized text box) */}
          {content && (
            <div>
              <div
                className={cn(
                  "activity-info-desc-content text-sm sm:text-[0.9375rem] text-[var(--slate-12)] dark:text-slate-100 font-normal leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] transition-all duration-200",
                  !isExpanded && isLong
                    ? "line-clamp-5 overflow-hidden sm:line-clamp-none sm:overflow-visible"
                    : "line-clamp-none"
                )}
              >
                {content}
              </div>

              {isLong && (
                <button
                  type="button"
                  onClick={toggleExpand}
                  className="mt-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 inline-flex sm:hidden items-center gap-1 cursor-pointer select-none transition-colors"
                >
                  <span>{isExpanded ? 'See less' : 'See more'}</span>
                  {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
            </div>
          )}

          {/* Card Footer for Op Period Navigation */}
          {renderOpPeriodFooter()}
        </div>
      );
    }

    // ── SCENARIO B: Both Description and Pre-Plan exist (Tabbed view with touching stylized container) ──
    return (
      <div
        className="card activity-info-card activity-info-desc-card animate-slide-up w-full order-1 lg:order-none"
        style={{
          padding: '22px 26px',
          animationDelay: `${animIdx * 50}ms`,
          animationFillMode: 'both',
        }}
      >
        {/* Header Row: Badges on mobile top/right, Tabs docked seamlessly to the folder container */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5 sm:gap-4 mb-0">
          {/* File Folder Tabs: Layered under the elevated container (centered on mobile, left-aligned on desktop) */}
          <div className="order-2 sm:order-1 flex items-end justify-center sm:justify-start w-full sm:w-auto">
            <div className="flex items-end gap-1.5 pl-0 sm:pl-4 justify-center sm:justify-start -mb-[1px] relative z-10">
              <button
                type="button"
                onClick={() => setActiveTab('description')}
                className={cn(
                  "flex items-center gap-2 px-4 text-sm font-semibold rounded-t-xl transition-all cursor-pointer select-none",
                  activeTab === 'description'
                    ? "bg-[var(--slate-1)] dark:bg-slate-800/90 text-[var(--slate-12)] dark:text-slate-100 border-t border-x border-[var(--slate-3)] dark:border-slate-700/80 pt-2 pb-2.5 font-bold shadow-xs relative z-10"
                    : "bg-slate-200/50 hover:bg-slate-200/80 dark:bg-slate-800/30 dark:hover:bg-slate-800/60 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 border border-[var(--slate-3)] dark:border-slate-700/80 py-1.5 font-medium relative z-0"
                )}
                aria-selected={activeTab === 'description'}
                role="tab"
              >
                <Info size={15} className={activeTab === 'description' ? "text-[var(--navy-7)] dark:text-sky-400 shrink-0" : "text-slate-400 shrink-0"} />
                <span>Description</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('preplan')}
                className={cn(
                  "flex items-center gap-2 px-4 text-sm font-semibold rounded-t-xl transition-all cursor-pointer select-none",
                  activeTab === 'preplan'
                    ? "bg-[var(--slate-1)] dark:bg-slate-800/90 text-[var(--slate-12)] dark:text-slate-100 border-t border-x border-[var(--slate-3)] dark:border-slate-700/80 pt-2 pb-2.5 font-bold shadow-xs relative z-10"
                    : "bg-slate-200/50 hover:bg-slate-200/80 dark:bg-slate-800/30 dark:hover:bg-slate-800/60 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 border border-[var(--slate-3)] dark:border-slate-700/80 py-1.5 font-medium relative z-0"
                )}
                aria-selected={activeTab === 'preplan'}
                role="tab"
              >
                <ClipboardList size={15} className={activeTab === 'preplan' ? "text-[var(--navy-7)] dark:text-sky-400 shrink-0" : "text-slate-400 shrink-0"} />
                <span>Pre-Plan</span>
              </button>
            </div>
          </div>

          {/* Badges: Order 1 on mobile top, Order 2 on desktop right */}
          <div className="order-1 sm:order-2 flex items-center gap-2 flex-wrap justify-between sm:justify-end w-full sm:w-auto mb-2 sm:mb-2.5">
            <ActivityStatusBadges
              activity={activity}
              activityType={activityType || activity?.type || 'exercise'}
              attendees={attendees}
              isLocal={isLocal}
              onAttendanceChanged={onAttendanceChanged}
            />
          </div>
        </div>

        {/* Elevated Cohesive Content Container (Higher browser z-index elevation than Tab Buttons) */}
        <div className="activity-info-doc-container bg-[var(--slate-1)] dark:bg-slate-800/90 border border-[var(--slate-3)] dark:border-slate-700/80 rounded-xl p-4 sm:p-5 shadow-2xs relative z-20">
          {/* Tab 1: Description Content */}
          {showingDescTab ? (
            <div>
              {cleanedDesc && (
                <div>
                  <div
                    className={cn(
                      "activity-info-desc-content text-sm sm:text-[0.9375rem] text-[var(--slate-12)] dark:text-slate-100 font-normal leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] transition-all duration-200",
                      !isDescExpanded && isLongDesc
                        ? "line-clamp-5 overflow-hidden sm:line-clamp-none sm:overflow-visible"
                        : "line-clamp-none"
                    )}
                  >
                    {cleanedDesc}
                  </div>

                  {isLongDesc && (
                    <button
                      type="button"
                      onClick={() => setIsDescExpanded((prev) => !prev)}
                      className="mt-2 text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 inline-flex sm:hidden items-center gap-1 cursor-pointer select-none transition-colors"
                    >
                      <span>{isDescExpanded ? 'See less' : 'See more'}</span>
                      {isDescExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Tab 2: Pre-Plan Content */
            <div>
              <div
                className={cn(
                  "activity-info-preplan-content text-sm sm:text-[0.9375rem] text-[var(--slate-12)] dark:text-slate-100 font-normal leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] transition-all duration-200",
                  !isPrePlanExpanded && isLongPrePlan
                    ? "line-clamp-5 overflow-hidden sm:line-clamp-none sm:overflow-visible"
                    : "line-clamp-none"
                )}
              >
                {cleanedPrePlan}
              </div>

              {isLongPrePlan && (
                <button
                  type="button"
                  onClick={() => setIsPrePlanExpanded((prev) => !prev)}
                  className="mt-2 text-xs font-semibold text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300 inline-flex sm:hidden items-center gap-1 cursor-pointer select-none transition-colors"
                >
                  <span>{isPrePlanExpanded ? 'See less' : 'See more'}</span>
                  {isPrePlanExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Card Footer for Op Period Navigation (outside the stylized box) */}
        {renderOpPeriodFooter()}
      </div>
    );
  };

  const renderPersonnelCard = (animIdx = 4) => (
    <div
      className="card activity-info-card animate-slide-up w-full order-5 lg:order-none"
      style={{
        padding: '22px 26px',
        animationDelay: `${animIdx * 50}ms`,
        animationFillMode: 'both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '1px solid var(--slate-3)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={18} style={{ color: 'var(--navy-7)' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--slate-12)', margin: 0 }}>
            Responding Personnel
          </h2>
          <Badge
            variant="secondary"
            className="h-5 px-2 text-[0.6875rem] font-bold text-slate-700 bg-slate-100 border-slate-300 dark:bg-slate-800 dark:text-slate-300"
          >
            {uniqueMemberIds.size} {uniqueMemberIds.size === 1 ? 'member' : 'members'}
          </Badge>
        </div>
      </div>

      {displayedAttendees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--slate-9)', fontSize: '0.875rem' }}>
          No confirmed responding personnel found.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {displayedAttendees.map((att, idx) => {
            const memberId = att.member?.id;
            const m = memberId ? memberMap.get(memberId) : undefined;
            const name = att.member?.name || m?.name || 'Responding Member';
            const roleTitle = att.role?.title || m?.role?.title || m?.position;
            const shiftsCount = (att as any)._shiftsCount || 1;
            const medicalQual = memberId && medicalMap ? medicalMap[memberId] : undefined;
            const technicalQual = memberId && technicalMap ? technicalMap[memberId] : undefined;

            return (
              <MemberPopover
                key={memberId ?? idx}
                member={m}
                attendee={att}
                contextId={contextId}
                activity={activity}
                medicalQual={medicalQual}
                technicalQual={technicalQual}
                isLocal={isLocal}
              >
                <div
                  className="member-tile"
                  style={{
                    background: 'var(--slate-1)',
                    border: '1px solid var(--slate-3)',
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 64,
                    height: 64,
                    overflow: 'hidden',
                    transition: 'all 0.15s ease',
                    cursor: 'pointer',
                  }}
                >
                  <MemberTileAvatar
                    contextId={contextId}
                    memberId={memberId ?? 0}
                    name={name}
                    isReadyToLoadPictures={isReadyToLoadPictures}
                  />

                  <div
                    style={{
                      padding: '10px 14px',
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    {!name || name === 'Responding Member' ? (
                      <div className="skeleton" style={{ width: '60%', height: 16, borderRadius: 4, marginBottom: 2 }} />
                    ) : (
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.875rem',
                          color: 'var(--slate-12)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {name}
                      </span>
                    )}

                    {/* Subtitle: Position / Role + Arrival */}
                    {(roleTitle || (isMultiPeriod && (att.startsAt || activity?.startsAt || (activity as any)?.startDate))) && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--slate-10)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          minWidth: 0,
                        }}
                      >
                        {roleTitle && <Shield size={12} style={{ color: 'var(--slate-8)', flexShrink: 0 }} />}
                        <span
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {[
                            roleTitle,
                            isMultiPeriod && (att.startsAt || activity?.startsAt || (activity as any)?.startDate)
                              ? `Arrives ${format(new Date(att.startsAt || activity?.startsAt || (activity as any)?.startDate), 'MM/dd')}${(att as any)._allOpDates?.length > 1 ? ` for ${(att as any)._allOpDates.length}d` : shiftsCount > 1 ? ` for ${shiftsCount}d` : ''}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </MemberPopover>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderAttachmentsCard = (animIdx = 3) => (
    <ActivityAttachmentsCard
      contextId={contextId}
      activity={activity}
      activityType={activityType}
      isLocal={isLocal}
      className="w-full order-4 lg:order-none"
      style={{
        animationDelay: `${animIdx * 50}ms`,
        animationFillMode: 'both',
      }}
    />
  );

  return (
    <div className="activity-info-view animate-fade-in flex flex-col lg:grid lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-5 items-start">
      {/* ── Left Column on Desktop (Description & Pre-Plan Tabbed Card + Personnel) ── */}
      <div className="contents lg:flex lg:flex-col lg:col-span-2 lg:gap-5">
        {renderDescriptionAndPlanCard(0)}
        {renderPersonnelCard(4)}
      </div>

      {/* ── Right Column on Desktop (Location + Date & Conditions + Attachments) ─── */}
      <div className="contents lg:flex lg:flex-col lg:col-span-1 lg:gap-5">
        {renderLocationCard(1)}
        {renderDateAndConditionsCard(2)}
        {renderAttachmentsCard(3)}
      </div>
    </div>
  );
};

