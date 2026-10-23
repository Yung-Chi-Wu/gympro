// While 今天 loads: the same frame as the page (page.tsx), so nothing moves when it arrives:
// the greeting, then today's log and the report, side by side once the page is wide enough
export default function DashboardLoading() {
    return (
        <div className="space-y-5 md:space-y-6">
            <div className="h-7 w-48 rounded-lg bg-ink/10 animate-pulse md:h-9 md:w-72" />

            <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[3fr_2fr] @4xl:gap-6">
                <div className="space-y-4 rounded-2xl border border-line bg-card p-4 md:p-5">
                    <div className="flex justify-between">
                        <div className="h-6 w-24 rounded bg-ink/10 animate-pulse" />
                        <div className="h-6 w-16 rounded bg-ink/10 animate-pulse" />
                    </div>
                    {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-ink/10 animate-pulse" />)}
                    <div className="h-10 rounded-md bg-ink/10 animate-pulse" />
                </div>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <div className="h-6 w-28 rounded bg-ink/10 animate-pulse" />
                        <div className="h-3.5 w-40 rounded bg-ink/10 animate-pulse" />
                    </div>
                    <div className="space-y-3 rounded-[14px] border border-line bg-card p-4 md:p-6">
                        <div className="h-5 w-3/4 rounded bg-ink/10 animate-pulse" />
                        <div className="h-4 w-full rounded bg-ink/10 animate-pulse" />
                        <div className="h-4 w-5/6 rounded bg-ink/10 animate-pulse" />
                        <div className="h-32 rounded-lg bg-ink/10 animate-pulse" />
                    </div>
                </div>
            </div>
        </div>
    )
}
