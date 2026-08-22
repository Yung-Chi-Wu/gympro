export default function RoutinesLoading() {
    return (
        <div className="py-8 space-y-10">
            <div className="h-10 w-40 rounded-lg bg-ink/10 animate-pulse" />

            <div className="space-y-4">
                <div className="h-6 w-32 rounded bg-ink/10 animate-pulse" />
                <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
                    <div className="h-10 w-24 rounded bg-ink/10 animate-pulse" />
                </div>
                <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm space-y-3">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex gap-3">
                            <div className="h-8 w-16 rounded bg-ink/10 animate-pulse" />
                            <div className="h-8 flex-1 rounded bg-ink/10 animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-4">
                <div className="h-6 w-28 rounded bg-ink/10 animate-pulse" />
                <div className="h-12 rounded-md bg-ink/10 animate-pulse" />
                {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm">
                        <div className="h-6 w-32 rounded bg-ink/10 animate-pulse" />
                    </div>
                ))}
            </div>
        </div>
    )
}