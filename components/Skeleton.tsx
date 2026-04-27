export function Skeleton({
  className = "h-4 w-full",
}: {
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse bg-coco-100 rounded-md ${className}`}
      aria-hidden
    />
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
