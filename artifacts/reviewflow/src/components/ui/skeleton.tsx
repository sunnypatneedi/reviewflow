import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rf-skel motion-reduce:after:hidden", className)}
      {...props}
    />
  );
}

export { Skeleton };
