// While 課表 loads: the cycle strip and two panes side by side, the list on a phone
export default function RoutinesLoading() {
    return (
        <div className="space-y-4">
            <div className="h-8 w-28 rounded-lg bg-ink/10 animate-pulse max-md:hidden" />
            <div className="h-9 w-40 rounded-[9px] bg-ink/10 animate-pulse @split:hidden" />
            <div className="hidden h-28 rounded-[14px] border border-line bg-card @split:block" />
            <div className="gap-4 @split:grid @split:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
                <div className="space-y-4 rounded-[14px] border border-line bg-card p-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="space-y-1.5">
                            <div className="h-4 w-24 rounded bg-ink/10 animate-pulse" />
                            <div className="h-3 w-40 rounded bg-ink/10 animate-pulse" />
                        </div>
                    ))}
                </div>
                <div className="hidden h-80 rounded-[14px] border border-line bg-card @split:block" />
            </div>
        </div>
    )
}
