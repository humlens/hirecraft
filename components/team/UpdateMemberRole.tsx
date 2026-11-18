import { defaultHeaders } from '@/lib/common';
import { Team, TeamMember } from '@prisma/client';
import usePortalRoles from 'hooks/usePortalRoles';
import useTeamMembers, { TeamMemberWithUser } from 'hooks/useTeamMembers';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

interface UpdateMemberRoleProps {
  team: Team;
  member: TeamMemberWithUser;
}

const UpdateMemberRole = ({ team, member }: UpdateMemberRoleProps) => {
  const { t } = useTranslation('common');
  const { roles } = usePortalRoles(team.slug);
  const { mutateTeamMembers } = useTeamMembers(team.slug);

  const updateRole = async (member: TeamMember, portalRoleId: string) => {
    const response = await fetch(`/api/teams/${team.slug}/members`, {
      method: 'PATCH',
      headers: defaultHeaders,
      body: JSON.stringify({
        memberId: member.userId,
        // A member without a portal role keeps its base role until a portal
        // role is picked.
        portalRoleId,
      }),
    });

    const json = (await response.json()) as ApiResponse;

    if (!response.ok) {
      toast.error(json.error.message);
      mutateTeamMembers();
      return;
    }

    toast.success(t('member-role-updated'));
    mutateTeamMembers();
  };

  return (
    <select
      className="select select-bordered select-sm rounded"
      aria-label={t('role')}
      value={member.portalRoleId ?? ''}
      onChange={(e) => e.target.value && updateRole(member, e.target.value)}
    >
      {!member.portalRoleId && (
        <option value="" disabled>
          {member.role}
        </option>
      )}
      {(roles ?? []).map((role) => (
        <option value={role.id} key={role.id}>
          {role.name}
        </option>
      ))}
    </select>
  );
};

export default UpdateMemberRole;
