import { Input, InputProps } from '@/components/ui/daisy';

interface InputWithLabelProps extends InputProps {
  label: string | React.ReactNode;
  error?: string;
  descriptionText?: string;
  /** control shown inside the input on the right (e.g. show/hide password) */
  trailing?: React.ReactNode;
}

const InputWithLabel = (props: InputWithLabelProps) => {
  const { label, error, descriptionText, trailing, ...rest } = props;
  // Associate the label with the input for accessibility.
  const id = rest.id ?? rest.name;

  const classes = ['text-sm'];

  if (error) {
    classes.push('input-error');
  }

  return (
    <div className="flex flex-col w-full">
      {typeof label === 'string' ? (
        <label className="label" htmlFor={id}>
          <span className="text-sm">{label}</span>
        </label>
      ) : (
        label
      )}
      <div className="relative">
        <Input
          className={`w-full ${classes.join(' ')}${trailing ? ' pr-11' : ''}`}
          {...rest}
          id={id}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-3 flex items-center">
            {trailing}
          </span>
        )}
      </div>
      {(error || descriptionText) && (
        <label className="label">
          <span className={`text-xs ${error ? 'text-red-500' : ''}`}>
            {error || descriptionText}
          </span>
        </label>
      )}
    </div>
  );
};

export default InputWithLabel;
