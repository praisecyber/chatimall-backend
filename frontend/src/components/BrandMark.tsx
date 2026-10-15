export default function BrandMark({
  size = 36,
  variant = 'solid',
  className = '',
}: {
  size?: number;
  variant?: 'solid' | 'light';
  className?: string;
}) {
  return (
    <img
      src="/app-icon/chatimall-round-icon.svg"
      width={size}
      height={size}
      className={className}
      style={variant === 'light' ? { filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.18))' } : undefined}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
