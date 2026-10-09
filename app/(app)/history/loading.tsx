// While 紀錄 loads: the tabs, then a calendar and a day side by side, or a list on a phone
export default function HistoryLoading() {
    return (
        <div className="space-y-4">
            <div className="h-8 w-28 rounded-lg bg-ink/10 animate-pulse max-md:hidden" />
            <div className="flex gap-4 border-b border-line pb-2">
                {[...Array(3)].map((_, i) => <div key={i} className="h-5 w-10 rounded bg-ink/10 animate-pulse" />)}
            </div>
            <div className="gap-4 @split:grid @split:grid-cols-[minmax(270px,320px)_minmax(0,1fr)]">
                <div className="space-y-4 rounded-[14px] border border-line bg-card p-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="space-y-1.5">
                            <div className="h-4 w-32 rounded bg-ink/10 animate-pulse" />
                            <div className="h-3 w-44 rounded bg-ink/10 animate-pulse" />
                        </div>
                    ))}
                </div>
                <div className="hidden h-96 rounded-[14px] border border-line bg-card @split:block" />
            </div>
        </div>
    )
}
