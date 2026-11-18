import React from 'react';
import * as Yup from 'yup';
import { mutate } from 'swr';
import { useFormik } from 'formik';
import toast from 'react-hot-toast';
import { Button, Input } from 'react-daisyui';
import { useTranslation } from 'next-i18next';

import type { ApiResponse } from 'types';
import { defaultHeaders, maxLengthPolicies } from '@/lib/common';
import usePortalRoles from 'hooks/usePortalRoles';
import type { Team } from '@prisma/client';

interface InviteViaEmailProps {
  team: Team;
  setVisible: (visible: boolean) => void;
}

const InviteViaEmail = ({ setVisible, team }: InviteViaEmailProps) => {
  const { t } = useTranslation('common');
  const { roles } = usePortalRoles(team.slug);
  // Least-privilege default: the Viewer role, else the first member-level role
  const defaultRoleId =
    (
      roles?.find((r) => r.key === 'viewer') ??
      roles?.find((r) => r.baseRole === 'MEMBER')
    )?.id ?? '';

  const FormValidationSchema = Yup.object().shape({
    email: Yup.string()
      .email()
      .max(maxLengthPolicies.email)
      .required(t('require-email')),
    portalRoleId: Yup.string().required(t('required-role')),
  });

  const formik = useFormik({
    initialValues: {
      email: '',
      portalRoleId: defaultRoleId,
      sentViaEmail: true,
    },
    enableReinitialize: true,
    validationSchema: FormValidationSchema,
    onSubmit: async (values) => {
      const response = await fetch(`/api/teams/${team.slug}/invitations`, {
        method: 'POST',
        headers: defaultHeaders,
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const result = (await response.json()) as ApiResponse;
        toast.error(result.error.message);
        return;
      }

      toast.success(t('invitation-sent'));
      mutate(`/api/teams/${team.slug}/invitations?sentViaEmail=true`);
      setVisible(false);
      formik.resetForm();
    },
  });

  return (
    <form onSubmit={formik.handleSubmit} method="POST" className="pb-6">
      <h3 className="font-medium text-[14px] pb-2">{t('invite-via-email')}</h3>
      <div className="flex gap-1">
        <Input
          name="email"
          onChange={formik.handleChange}
          value={formik.values.email}
          placeholder="jackson@boxyhq.com"
          required
          className="text-sm w-1/2"
          type="email"
        />
        <select
          className="select-bordered select rounded"
          name="portalRoleId"
          onChange={formik.handleChange}
          value={formik.values.portalRoleId}
          required
        >
          <option value="" disabled>
            {t('role')}
          </option>
          {(roles ?? []).map((role) => (
            <option value={role.id} key={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          color="primary"
          loading={formik.isSubmitting}
          disabled={!formik.isValid || !formik.dirty}
          className="flex-grow"
        >
          {t('send-invite')}
        </Button>
      </div>
    </form>
  );
};

export default InviteViaEmail;
