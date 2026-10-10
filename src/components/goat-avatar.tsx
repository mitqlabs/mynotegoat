/** The G.O.A.T. avatar (static). Shown next to the "G.O.A.T." label and its answers. */
export function GoatAvatar({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt="G.O.A.T."
      className={`inline-block shrink-0 self-start rounded-full object-cover ${className}`}
      draggable={false}
      height={size}
      src={size > 40 ? "/goat-avatar/avatar-128.png" : "/goat-avatar/avatar-64.png"}
      srcSet={size > 40 ? undefined : "/goat-avatar/avatar-64.png 1x, /goat-avatar/avatar-128.png 2x"}
      style={{ width: size, height: size }}
      width={size}
    />
  );
}
