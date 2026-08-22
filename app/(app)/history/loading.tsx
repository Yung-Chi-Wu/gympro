export default function HistoryLoading() {
    return (
        <div className="py-8 space-y-6">
            <div className="h-10 w-40 rounded-lg bg-ink/10 animate-pulse" />

            <div className="rounded-2xl border border-ink/10 bg-white shadow-sm">
                <div className="p-6">
                    <div className="h-6 w-28 rounded bg-ink/10 animate-pulse" />
                    <div className="mt-4 h-48 rounded-lg bg-ink/10 animate-pulse" />
                </div>
            </div>

            {[...Array(5)].map((_, i) => (
                <div key={i} className="rounded-2xl border border-ink/10 bg-white shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-ink/[0.02] border-b border-ink/10">
                        <div className="h-5 w-36 rounded bg-ink/10 animate-pulse" />
                    </div>
                    <div className="px-4 py-3 border-b border-ink/10">
                        <div className="h-4 w-28 rounded bg-ink/10 animate-pulse" />
                    </div>
                    <div className="px-4 py-3">
                        <div className="h-4 w-20 rounded bg-ink/10 animate-pulse" />
                    </div>
                </div>
            ))}
        </div>
    )
}