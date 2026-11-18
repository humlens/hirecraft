import { Input, InputProps } from 'react-daisyui';

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
    <div className="form-control w-full">
      {typeof label === 'string' ? (
        <label className="label" htmlFor={id}>
          <span className="label-text">{label}</span>
        </label>
      ) : (
        label
      )}
      <Input className={classes.join(' ')} {...rest} id={id} />
      {(error || descriptionText) && (
        <label className="label">
          <span className={`label-text-alt ${error ? 'text-red-500' : ''}`}>
            {error || descriptionText}
          </span>
        </label>
      )}
    </div>
  );
};

export default InputWithLabel;
