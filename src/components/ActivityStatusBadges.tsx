import React, { useEffect, useState, useMemo } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Badge } from '@/components/ui/badge';
import {
  Check,
  ChevronDown,
  HelpCircle,
  Loader2,
  UserCheck,
  X,
} from 'lucide-react';
import type { Activity, Attendee, UserPermissions } from '../api/d4h';
import {
  canUserRespondToActivity,
  createUserAttendance,
  getCurrentUserPermissions,
  getUserAttendanceForActivity,
  updateUserAttendance,
} from '../api/d4h';

interface ActivityStatusBadgesProps {
  activity: Activity | null;
  activityType: string;
  attendees: Attendee[];
  isLocal?: boolean;
  onAttendanceChanged?: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  exercise: 'Exercise',
  event: 'Event',
  incident: 'Incident',
  local: 'Local Roster',
};

export const ActivityStatusBadges: React.FC<ActivityStatusBadgesProps> = ({
  activity,
  activityType,
  attendees,
  isLocal = false,
  onAttendanceChanged,
}) => {
  const startDate = activity?.startsAt ? new Date(activity.startsAt) : new Date();
  const isPast = (activity?.endsAt ? new Date(activity.endsAt) : startDate) < new Date();

  const contextIdStr = localStorage.getItem('d4h_context_id');
  const contextId = contextIdStr ? Number(contextIdStr) : null;
  const cachedMemberIdStr = localStorage.getItem('d4h_member_id');
  const cachedMemberId = cachedMemberIdStr ? Number(cachedMemberIdStr) : null;

  const [userPermissions, setUserPermissions] = useState<UserPermissions>({
    canUpdateOwnAttendance: false,
    canCreateAttendance: false,
    canUpdateAllAttendance: false,
    canUpdateExercise: false,
    canUpdateIncident: false,
    canUpdateEvent: false,
    memberId: cachedMemberId,
  });
  const [userAttendance, setUserAttendance] = useState<Attendee | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  useEffect(() => {
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

  const effectiveMemberId = userPermissions.memberId || cachedMemberId;

  const isMarkedAttending =
    attendees.some((a) => a.member?.id === effectiveMemberId || a.id === userAttendance?.id) ||
    userAttendance?.status === 'ATTENDING' ||
    userAttendance?.status === 'attending' ||
    userAttendance?.status === 'CONFIRMED' ||
    userAttendance?.status === 'confirmed';

  const effectiveStatus = userAttendance?.status?.toUpperCase() || (isMarkedAttending ? 'ATTENDING' : null);

  const canRespondToEvent = useMemo(() => {
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

  const handleStatusChange = async (newStatus: 'ATTENDING' | 'ABSENT' | 'REQUESTED') => {
    if (!contextId || !activity?.id || !effectiveMemberId || isUpdatingStatus || isPast || !canRespondToEvent) return;

    setIsUpdatingStatus(true);
    const prevAttendance = userAttendance;

    // Optimistic update
    setUserAttendance((prev) => ({
      id: prev?.id || 0,
      status: newStatus,
      member: { id: effectiveMemberId!, resourceType: 'Member' },
    }));

    try {
      if (prevAttendance?.id) {
        const updated = await updateUserAttendance(contextId, prevAttendance.id, newStatus);
        setUserAttendance(updated);
      } else {
        const created = await createUserAttendance(contextId, {
          activityId: activity.id,
          memberId: effectiveMemberId,
          startsAt: activity.startsAt || new Date().toISOString(),
          endsAt: activity.endsAt || new Date().toISOString(),
          status: newStatus,
        });
        setUserAttendance(created);
      }
      onAttendanceChanged?.();
    } catch (err) {
      console.error('Failed to update attendance status:', err);
      setUserAttendance(prevAttendance);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const typeColorClass =
    activityType === 'incident'
      ? 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800'
      : activityType === 'event'
      ? 'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800'
      : activityType === 'local'
      ? 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
      : 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Badge
        variant="outline"
        className={`h-7 px-2.5 text-xs font-bold uppercase tracking-wider shadow-xs border ${typeColorClass}`}
      >
        {TYPE_LABELS[activityType] || 'Activity'}
      </Badge>

      {activity?.reference && (
        <Badge
          variant="outline"
          className="h-7 px-2.5 text-xs font-bold font-mono tracking-wider text-slate-700 bg-slate-100/70 border-slate-300 dark:text-slate-300 dark:bg-slate-800"
        >
          #{activity.reference}
        </Badge>
      )}

      <Badge
        variant={isPast ? 'secondary' : 'outline'}
        className={`h-7 px-2.5 text-xs font-bold ${
          isPast
            ? 'text-slate-600 bg-slate-100 border-slate-200'
            : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
        }`}
      >
        {isPast ? 'Completed' : 'Upcoming / Active'}
      </Badge>

      {canRespondToEvent ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              disabled={isUpdatingStatus}
              style={{
                height: 28,
                padding: '0 8px',
                borderRadius: 6,
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                cursor: isUpdatingStatus ? 'not-allowed' : 'pointer',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
                background:
                  effectiveStatus === 'ATTENDING'
                    ? '#ecfdf5'
                    : effectiveStatus === 'ABSENT'
                    ? 'var(--slate-2)'
                    : 'var(--slate-2)',
                color:
                  effectiveStatus === 'ATTENDING'
                    ? '#047857'
                    : effectiveStatus === 'ABSENT'
                    ? 'var(--slate-10)'
                    : 'var(--slate-10)',
                border:
                  effectiveStatus === 'ATTENDING'
                    ? '1px solid #a7f3d0'
                    : effectiveStatus === 'ABSENT'
                    ? '1px solid var(--slate-4)'
                    : '1px dashed var(--slate-5)',
              }}
            >
              {isUpdatingStatus ? (
                <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              ) : effectiveStatus === 'ATTENDING' ? (
                <UserCheck size={12} strokeWidth={2.5} />
              ) : effectiveStatus === 'ABSENT' ? (
                <X size={12} strokeWidth={2.5} />
              ) : (
                <HelpCircle size={12} strokeWidth={2} />
              )}
              <span>
                {effectiveStatus === 'ATTENDING'
                  ? isPast
                    ? 'Attended'
                    : 'Attending'
                  : effectiveStatus === 'ABSENT'
                  ? 'Not Attending'
                  : 'No Response'}
              </span>
              <ChevronDown size={11} style={{ opacity: 0.6, marginLeft: 1 }} />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="select-content no-print"
              align="end"
              sideOffset={5}
              style={{
                padding: 4,
                minWidth: 160,
                background: 'white',
                border: '1px solid var(--slate-4)',
                borderRadius: 8,
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                zIndex: 9999,
              }}
            >
              <DropdownMenu.Item
                className="select-item"
                onSelect={() => handleStatusChange('ATTENDING')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: 5,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#047857',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <UserCheck size={14} />
                  <span>{isPast ? 'Attended' : 'Attending'}</span>
                </div>
                {effectiveStatus === 'ATTENDING' && <Check size={13} strokeWidth={2.5} />}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                className="select-item"
                onSelect={() => handleStatusChange('ABSENT')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: 5,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--slate-11)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <X size={14} />
                  <span>Not Attending</span>
                </div>
                {effectiveStatus === 'ABSENT' && <Check size={13} strokeWidth={2.5} />}
              </DropdownMenu.Item>

              <DropdownMenu.Item
                className="select-item"
                onSelect={() => handleStatusChange('REQUESTED')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: 5,
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--slate-10)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <HelpCircle size={14} />
                  <span>No Response</span>
                </div>
                {(effectiveStatus === 'REQUESTED' || !effectiveStatus) && (
                  <Check size={13} strokeWidth={2.5} />
                )}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : isMarkedAttending ? (
        <Badge
          variant="outline"
          className="h-7 px-2.5 text-xs font-bold border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1.5"
        >
          <UserCheck size={12} strokeWidth={2.5} />
          {isPast ? 'Attended' : 'Attending'}
        </Badge>
      ) : null}
    </div>
  );
};
