export default function DashboardLoading() {
    return (
        <div className="py-8 space-y-6">
            <div className="h-10 w-56 rounded-lg bg-ink/10 animate-pulse" />

            <div className="rounded-xl border border-ink/10 bg-white p-6 space-y-4">
                <div className="flex justify-between">
                    <div className="h-6 w-16 rounded bg-ink/10 animate-pulse" />
                    <div className="h-6 w-24 rounded bg-ink/10 animate-pulse" />
                </div>
                <div className="h-24 rounded-xl bg-ink/10 animate-pulse" />
                <div className="h-24 rounded-xl bg-ink/10 animate-pulse" />
                <div className="h-10 rounded-md bg-ink/10 animate-pulse" />
            </div>

            <div className="rounded-xl border border-ink/10 bg-white p-6 space-y-3">
                <div className="h-6 w-24 rounded bg-ink/10 animate-pulse" />
                <div className="h-12 rounded-md bg-ink/10 animate-pulse" />
                <div className="h-16 rounded-md bg-ink/10 animate-pulse" />
            </div>

            <div className="space-y-3">
                <div className="h-8 w-40 rounded bg-ink/10 animate-pulse" />
                <div className="rounded-xl border border-ink/10 bg-white p-6">
                    <div className="h-40 rounded-lg bg-ink/10 animate-pulse" />
                </div>
            </div>
        </div>
    )
}