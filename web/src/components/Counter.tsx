// Render the reported count directly so total and today's count stay consistent.
export function Counter({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  return (
    <span className={`counter ${className}`}>
      {value.toLocaleString("zh-CN")}
    </span>
  );
}
