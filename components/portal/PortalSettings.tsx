import { Card, Error, InputWithLabel, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useTranslation } from 'next-i18next';
import usePortal from 'hooks/usePortal';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/daisy';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

type Section = 'profile' | 'branding';

const PortalSettings = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { isLoading, isError, portal, mutatePortal } = usePortal(slug);
  const [profile, setProfile] = useState({
    companyName: '',
    website: '',
    contactEmail: '',
    industry: '',
    description: '',
  });
  const [branding, setBranding] = useState({
    primaryColor: '#3346D3',
    theme: 'SYSTEM',
    heroTitle: '',
    heroSubtitle: '',
    aboutHtml: '',
    privacyPolicyHtml: '',
    seoTitle: '',
    seoDescription: '',
  });
  const [saving, setSaving] = useState<Section | null>(null);

  useEffect(() => {
    if (!portal) {
      return;
    }

    setProfile({
      companyName: portal.profile?.companyName ?? portal.team.name,
      website: portal.profile?.website ?? '',
      contactEmail: portal.profile?.contactEmail ?? '',
      industry: portal.profile?.industry ?? '',
      description: portal.profile?.description ?? '',
    });

    setBranding({
      primaryColor: portal.branding?.primaryColor ?? '#3346D3',
      theme: portal.branding?.theme ?? 'SYSTEM',
      heroTitle: portal.branding?.heroTitle ?? '',
      heroSubtitle: portal.branding?.heroSubtitle ?? '',
      aboutHtml: portal.branding?.aboutHtml ?? '',
      privacyPolicyHtml: portal.branding?.privacyPolicyHtml ?? '',
      seoTitle: portal.branding?.seoTitle ?? '',
      seoDescription: portal.branding?.seoDescription ?? '',
    });
  }, [portal]);

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  if (!portal) {
    return null;
  }

  const save = async (section: Section) => {
    setSaving(section);

    const response = await fetch(`/api/teams/${slug}/portal`, {
      method: 'PUT',
      headers: defaultHeaders,
      body: JSON.stringify({
        [section]: section === 'profile' ? profile : branding,
      }),
    });

    setSaving(null);

    if (!response.ok) {
      const json = (await response.json()) as ApiResponse;
      toast.error(json.error.message);
      return;
    }

    toast.success(t('successfully-updated'));
    mutatePortal();
  };

  return (
    <div className="space-y-6">
      <Card>
        <Card.Body>
          <Card.Header>
            <Card.Title>{t('portal-profile')}</Card.Title>
            <Card.Description>
              {t('portal-profile-description')}
            </Card.Description>
          </Card.Header>
          <fieldset
            disabled={!portal.canUpdateProfile}
            className="flex flex-col gap-4"
          >
            <InputWithLabel
              name="companyName"
              label={t('portal-company-name')}
              value={profile.companyName}
              onChange={(e) =>
                setProfile({ ...profile, companyName: e.target.value })
              }
            />
            <InputWithLabel
              name="website"
              label={t('portal-website')}
              value={profile.website}
              onChange={(e) =>
                setProfile({ ...profile, website: e.target.value })
              }
              placeholder="https://"
            />
            <InputWithLabel
              name="contactEmail"
              label={t('portal-contact-email')}
              type="email"
              value={profile.contactEmail}
              onChange={(e) =>
                setProfile({ ...profile, contactEmail: e.target.value })
              }
            />
            <InputWithLabel
              name="industry"
              label={t('portal-industry')}
              value={profile.industry}
              onChange={(e) =>
                setProfile({ ...profile, industry: e.target.value })
              }
            />
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('portal-description')}</span>
              <textarea
                name="description"
                className="textarea "
                rows={4}
                value={profile.description}
                onChange={(e) =>
                  setProfile({ ...profile, description: e.target.value })
                }
              />
            </label>
          </fieldset>
        </Card.Body>
        {portal.canUpdateProfile && (
          <Card.Footer>
            <Button
              color="primary"
              size="md"
              loading={saving === 'profile'}
              onClick={() => save('profile')}
            >
              {t('save-changes')}
            </Button>
          </Card.Footer>
        )}
      </Card>

      <Card>
        <Card.Body>
          <Card.Header>
            <Card.Title>{t('portal-branding')}</Card.Title>
            <Card.Description>
              {t('portal-branding-description')}
            </Card.Description>
          </Card.Header>
          <fieldset
            disabled={!portal.canUpdateBranding}
            className="flex flex-col gap-4"
          >
            <InputWithLabel
              name="primaryColor"
              label={t('portal-primary-color')}
              type="color"
              value={branding.primaryColor}
              onChange={(e) =>
                setBranding({ ...branding, primaryColor: e.target.value })
              }
            />
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('portal-theme')}</span>
              <select
                name="theme"
                className="select "
                value={branding.theme}
                onChange={(e) =>
                  setBranding({ ...branding, theme: e.target.value })
                }
              >
                <option value="SYSTEM">{t('portal-theme-system')}</option>
                <option value="LIGHT">{t('portal-theme-light')}</option>
                <option value="DARK">{t('portal-theme-dark')}</option>
              </select>
            </label>
            <InputWithLabel
              name="heroTitle"
              label={t('portal-hero-title')}
              value={branding.heroTitle}
              onChange={(e) =>
                setBranding({ ...branding, heroTitle: e.target.value })
              }
            />
            <InputWithLabel
              name="heroSubtitle"
              label={t('portal-hero-subtitle')}
              value={branding.heroSubtitle}
              onChange={(e) =>
                setBranding({ ...branding, heroSubtitle: e.target.value })
              }
            />
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('portal-about')}</span>
              <textarea
                name="aboutHtml"
                className="textarea "
                rows={5}
                value={branding.aboutHtml}
                onChange={(e) =>
                  setBranding({ ...branding, aboutHtml: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('portal-privacy')}</span>
              <textarea
                name="privacyPolicyHtml"
                className="textarea "
                rows={5}
                value={branding.privacyPolicyHtml}
                onChange={(e) =>
                  setBranding({
                    ...branding,
                    privacyPolicyHtml: e.target.value,
                  })
                }
              />
            </label>
            <InputWithLabel
              name="seoTitle"
              label={t('portal-seo-title')}
              value={branding.seoTitle}
              onChange={(e) =>
                setBranding({ ...branding, seoTitle: e.target.value })
              }
            />
            <InputWithLabel
              name="seoDescription"
              label={t('portal-seo-description')}
              value={branding.seoDescription}
              onChange={(e) =>
                setBranding({ ...branding, seoDescription: e.target.value })
              }
            />
          </fieldset>
        </Card.Body>
        {portal.canUpdateBranding && (
          <Card.Footer>
            <Button
              color="primary"
              size="md"
              loading={saving === 'branding'}
              onClick={() => save('branding')}
            >
              {t('save-changes')}
            </Button>
          </Card.Footer>
        )}
      </Card>
    </div>
  );
};

export default PortalSettings;
