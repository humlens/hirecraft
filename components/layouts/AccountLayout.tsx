import React from 'react';
import AppShell from '../shared/shell/AppShell';
import PortalShell from '../shared/shell/PortalShell';
import { useRouter } from 'next/router';
import { SWRConfig } from 'swr';

interface AccountLayoutProps {
  children: React.ReactNode;
}

export default function AccountLayout({ children }: AccountLayoutProps) {
  const { pathname } = useRouter();
  // every page of a portal gets the portal shell (top navigation); account pages keep the sidebar shell
  const Shell = pathname.startsWith('/teams/[slug]') ? PortalShell : AppShell;

  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
      }}
    >
      <Shell>{children}</Shell>
    </SWRConfig>
  );
}
