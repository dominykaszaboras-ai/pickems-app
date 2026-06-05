import clsx from "clsx";

export function TeamLogo({
  team,
  size = 24,
  className,
}: {
  team: { name: string; logo: string | null } | null;
  size?: number;
  className?: string;
}) {
  if (!team) {
    return (
      <span
        className={clsx("inline-block rounded-full bg-panel2", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  if (team.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={team.logo}
        alt={team.name}
        width={size}
        height={size}
        className={clsx("inline-block rounded-sm object-contain", className)}
      />
    );
  }
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-sm bg-panel2 text-[10px] font-bold uppercase",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {team.name.slice(0, 2)}
    </span>
  );
}
