import { PageHeader } from '@/components/ui';
import { PendingInvitations } from '@/components/invitation';
import { Error, Loading } from '@/components/shared';
import { Members, TeamTab } from '@/components/team';
import Roles from '@/components/portal/Roles';
import usePortalAccess from 'hooks/usePortalAccess';
import env from '@/lib/env';
import useTeam from 'hooks/useTeam';
import { GetServerSidePropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';

const TeamMembers = ({ teamFeatures }) => {
  const { t } = useTranslation('common');
  const { isLoading, isError, team } = useTeam();
  const { can } = usePortalAccess(team?.slug);

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  if (!team) {
    return <Error message={t('team-not-found')} />;
  }

  return (
    <>
      <TeamTab activeTab="members" team={team} teamFeatures={teamFeatures} />
      <div className="space-y-6">
        <PageHeader
          as="h1"
          title={t('team-and-permissions', 'Team & permissions')}
          subtitle={t(
            'team-and-permissions-sub',
            'Invite teammates, assign roles and see exactly what each role can do.'
          )}
        />
        <Members team={team} />
        <PendingInvitations team={team} />
        {(can('roles.manage') || can('members.invite')) && (
          <Roles slug={team.slug} />
        )}
      </div>
    </>
  );
};

export async function getServerSideProps({
  locale,
}: GetServerSidePropsContext) {
  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
      teamFeatures: env.teamFeatures,
    },
  };
}

export default TeamMembers;
