import { Input, InputProps } from '@/components/ui/daisy';

interface InputWithLabelProps extends InputProps {
  label: string | React.ReactNode;
  error?: string;
  descriptionText?: string;
}

const InputWithLabel = (props: InputWithLabelProps) => {
  const { label, error, descriptionText, ...rest } = props;
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
      <Input className={classes.join(' ')} {...rest} id={id} />
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
