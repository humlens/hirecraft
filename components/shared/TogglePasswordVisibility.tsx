import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'next-i18next';

/** Show/hide button; render it as the `trailing` prop of InputWithLabel. */
const TogglePasswordVisibility = ({
  isPasswordVisible,
  handlePasswordVisibility,
}: {
  isPasswordVisible: boolean;
  handlePasswordVisibility: () => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <button
      onClick={handlePasswordVisibility}
      className="flex items-center text-primary"
      type="button"
      aria-label={
        isPasswordVisible
          ? t('hide-password', 'Hide password')
          : t('show-password', 'Show password')
      }
    >
      {isPasswordVisible ? (
        <EyeSlashIcon className="h-5 w-5" />
      ) : (
        <EyeIcon className="h-5 w-5" />
      )}
    </button>
  );
};

export default TogglePasswordVisibility;
