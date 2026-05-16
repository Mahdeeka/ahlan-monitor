import clsx from "clsx";

const TONE_CLASS = {
  green:  "text-green-300",
  yellow: "text-yellow-300",
  orange: "text-orange-300",
  red:    "text-red-300",
  default: "text-white",
};

export function StatCard({
  label, value, sub, tone = "default",
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <div className="glass glass-hover rounded-xl p-3 sm:p-4 transition-all">
      <div className={clsx("text-xl sm:text-2xl font-bold", TONE_CLASS[tone])}>{value}</div>
      <div className="text-[10px] sm:text-xs text-slate-400 uppercase tracking-wider mt-1">{label}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
