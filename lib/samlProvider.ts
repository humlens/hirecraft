import type { OAuthConfig, OAuthUserConfig } from 'next-auth/providers/oauth';

export type SAMLProfile = Record<string, any> & {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
};

/**
 * NextAuth OAuth provider for the SAML SSO service (Jackson). The service
 * exposes a standard OAuth 2.0 authorization code flow with PKCE under
 * `/api/oauth/*`; `provider=saml` selects the SAML connection.
 */
export default function SAMLProvider<P extends SAMLProfile>(
  options: OAuthUserConfig<P>
): OAuthConfig<P> {
  return {
    id: 'saml-sso',
    name: 'SAML SSO',
    type: 'oauth',
    version: '2.0',
    checks: ['pkce', 'state'],
    authorization: {
      url: `${options.issuer}/api/oauth/authorize`,
      params: { provider: 'saml' },
    },
    token: `${options.issuer}/api/oauth/token`,
    userinfo: `${options.issuer}/api/oauth/userinfo`,
    profile(profile) {
      return {
        id: profile.id,
        email: profile.email,
        name: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
        image: null,
      };
    },
    options,
  };
}
