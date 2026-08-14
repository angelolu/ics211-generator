export const extractEmail = (email: any): string => {
  if (!email) return '';
  if (typeof email === 'string') return email;
  if (typeof email === 'object') {
    if (typeof email.value === 'string') return email.value;
    if (typeof email.email === 'string') return email.email;
  }
  return '';
};

export interface MemberDetailMaps {
  positionsMap: Record<number, string>;
  idsMap: Record<number, string>;
  statusMap: Record<number, string>;
  rolesMap: Record<number, string>;
  emailMap: Record<number, string>;
}

/**
 * Build lookup maps from member detail + attendee data.
 * Optionally pass attData to override roles from attendance records.
 */
export function buildMemberMaps(memberData: any[], attData?: any[]): MemberDetailMaps {
  const positionsMap: Record<number, string> = {};
  const idsMap: Record<number, string> = {};
  const statusMap: Record<number, string> = {};
  const rolesMap: Record<number, string> = {};
  const emailMap: Record<number, string> = {};

  memberData.forEach(m => {
    if (m.id) {
      if (m.position) positionsMap[m.id] = m.position;
      if (m.ref) idsMap[m.id] = m.ref;
      else if (m.idTag) idsMap[m.id] = m.idTag;
      else idsMap[m.id] = String(m.id);
      if (m.customStatus?.title) statusMap[m.id] = m.customStatus.title;
      else if (m.status) statusMap[m.id] = m.status;
      if (m.role?.title) rolesMap[m.id] = m.role.title;
      if (m.email) emailMap[m.id] = extractEmail(m.email);
    }
  });

  if (attData) {
    attData.forEach(att => {
      if (att.member?.id && att.role?.title) {
        rolesMap[att.member.id] = att.role.title;
      }
    });
  }

  return { positionsMap, idsMap, statusMap, rolesMap, emailMap };
}
