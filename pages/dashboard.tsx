import { Loading } from '@/components/shared';
import useTeams from 'hooks/useTeams';
import { useMyProfile } from 'hooks/useCandidate';
import { GetServerSidePropsContext } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import type { NextPageWithLayout } from 'types';

const Dashboard: NextPageWithLayout = () => {
  const router = useRouter();
  const { teams, isLoading } = useTeams();
  // Job seekers (a candidate profile and no portals) land on /me
  const { data: candidate, isLoading: candidateLoading } = useMyProfile();

  useEffect(() => {
    if (isLoading || !teams || candidateLoading) {
      return;
    }

    if (teams.length > 0) {
      router.push(`/teams/${teams[0].slug}/settings`);
    } else if (candidate?.id) {
      router.push('/me');
    } else {
      router.push('/onboarding');
    }
  }, [isLoading, router, teams, candidate, candidateLoading]);

  return <Loading />;
};

export async function getStaticProps({ locale }: GetServerSidePropsContext) {
  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
    },
  };
}

export default Dashboard;
