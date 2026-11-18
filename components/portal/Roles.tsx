import { Card, Error, Loading } from '@/components/shared';
import Modal from '@/components/shared/Modal';
import ConfirmationDialog from '@/components/shared/ConfirmationDialog';
import { defaultHeaders } from '@/lib/common';
import usePortalRoles from 'hooks/usePortalRoles';
import type { PortalRoleView } from 'models/portalRole';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { Button } from '@/components/ui/daisy';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

type Draft = {
  id?: string;
  name: string;
  description: string;
  baseRole: 'MEMBER' | 'ADMIN';
  permissions: string[];
};

const emptyDraft: Draft = {
  name: '',
  description: '',
  baseRole: 'MEMBER',
  permissions: ['portal.read'],
};

const Roles = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { isLoading, isError, roles, permissions, canManage, mutateRoles } =
    usePortalRoles(slug);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<PortalRoleView | null>(null);

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  if (!roles || !permissions) {
    return null;
  }

  const groups = Array.from(new Set(permissions.map((p) => p.group)));

  const save = async () => {
    if (!draft) {
      return;
    }

    setSaving(true);

    const response = await fetch(
      draft.id
        ? `/api/teams/${slug}/roles/${draft.id}`
        : `/api/teams/${slug}/roles`,
      {
        method: draft.id ? 'PUT' : 'POST',
        headers: defaultHeaders,
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          baseRole: draft.baseRole,
          permissions: draft.permissions,
        }),
      }
    );

    setSaving(false);

    if (!response.ok) {
      const json = (await response.json()) as ApiResponse;
      toast.error(json.error.message);
      return;
    }

    toast.success(t('portal-role-saved'));
    setDraft(null);
    mutateRoles();
  };

  const remove = async (role: PortalRoleView) => {
    const response = await fetch(`/api/teams/${slug}/roles/${role.id}`, {
      method: 'DELETE',
      headers: defaultHeaders,
    });

    if (!response.ok) {
      const json = (await response.json()) as ApiResponse;
      toast.error(json.error.message);
      return;
    }

    toast.success(t('portal-role-deleted'));
    setToDelete(null);
    mutateRoles();
  };

  const toggle = (key: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            permissions: d.permissions.includes(key)
              ? d.permissions.filter((k) => k !== key)
              : [...d.permissions, key],
          }
        : d
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-xl font-medium leading-none tracking-tight">
            {t('portal-roles')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('portal-roles-description')}
          </p>
        </div>
        {canManage && (
          <Button
            color="primary"
            size="md"
            onClick={() => setDraft(emptyDraft)}
          >
            {t('portal-new-role')}
          </Button>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="table table-sm" aria-label={t('portal-roles')}>
            <thead>
              <tr>
                <th>{t('portal-permission')}</th>
                {roles.map((role) => (
                  <th key={role.id} className="text-center">
                    <div>{role.name}</div>
                    <div className="text-xs font-normal opacity-60">
                      {t('portal-members-count', { count: role.memberCount })}
                    </div>
                    {canManage && !role.isSystem && (
                      <div className="space-x-1 pt-1">
                        <button
                          type="button"
                          className="btn btn-xs btn-link"
                          onClick={() =>
                            setDraft({
                              id: role.id,
                              name: role.name,
                              description: role.description ?? '',
                              baseRole:
                                role.baseRole === 'ADMIN' ? 'ADMIN' : 'MEMBER',
                              permissions: role.permissions,
                            })
                          }
                        >
                          {t('edit')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-xs btn-link link-error"
                          onClick={() => setToDelete(role)}
                        >
                          {t('remove')}
                        </button>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <PermissionGroup
                  key={group}
                  group={group}
                  roles={roles}
                  t={t}
                  rows={permissions.filter((p) => p.group === group)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={!!draft} close={() => setDraft(null)}>
        <Modal.Header>
          {draft?.id ? t('portal-edit-role') : t('portal-new-role')}
        </Modal.Header>
        <Modal.Body>
          <div className="space-y-4">
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('name')}</span>
              <input
                name="roleName"
                className="input "
                value={draft?.name ?? ''}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, name: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col w-full">
              <span className="text-sm pb-2">{t('portal-description')}</span>
              <input
                name="roleDescription"
                className="input "
                value={draft?.description ?? ''}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, description: e.target.value })
                }
              />
            </label>
            <fieldset className="space-y-3">
              <legend className="text-sm pb-1">
                {t('portal-permissions')}
              </legend>
              {groups.map((group) => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase opacity-60">
                    {group}
                  </p>
                  {permissions
                    .filter((p) => p.group === group)
                    .map((p) => (
                      <label
                        key={p.key}
                        className="flex items-center gap-2 py-0.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={!!draft?.permissions.includes(p.key)}
                          onChange={() => toggle(p.key)}
                        />
                        <span>{p.key}</span>
                        <span className="opacity-60">{p.description}</span>
                      </label>
                    ))}
                </div>
              ))}
            </fieldset>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(null)}
          >
            {t('close')}
          </Button>
          <Button
            type="button"
            color="primary"
            loading={saving}
            disabled={!draft || draft.name.trim().length < 2}
            onClick={save}
          >
            {t('save-changes')}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmationDialog
        visible={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) {
            remove(toDelete);
          }
        }}
        title={t('portal-delete-role')}
      >
        {t('portal-delete-role-warning', { name: toDelete?.name })}
      </ConfirmationDialog>
    </div>
  );
};

const PermissionGroup = ({
  group,
  rows,
  roles,
  t,
}: {
  t: (key: string) => string;
  group: string;
  rows: readonly { key: string; description: string }[];
  roles: PortalRoleView[];
}) => (
  <>
    <tr className="bg-base-200">
      <td
        colSpan={roles.length + 1}
        className="text-xs font-semibold uppercase"
      >
        {group}
      </td>
    </tr>
    {rows.map((p) => (
      <tr key={p.key}>
        <td>
          <div className="font-mono text-xs">{p.key}</div>
          <div className="text-xs opacity-60">{p.description}</div>
        </td>
        {roles.map((role) => (
          <td key={role.id} className="text-center">
            {role.permissions.includes(p.key) ? (
              <span aria-label={t('portal-granted')}>{'\u2713'}</span>
            ) : (
              <span aria-label={t('portal-not-granted')} className="opacity-30">
                {'\u2013'}
              </span>
            )}
          </td>
        ))}
      </tr>
    ))}
  </>
);

export default Roles;
