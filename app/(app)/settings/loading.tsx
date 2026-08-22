export default function SettingsLoading() {
    return (
        <div className="py-8 max-w-lg space-y-6">
            <div className="h-8 w-36 rounded-lg bg-ink/10 animate-pulse" />
            <div className="space-y-4">
                {[...Array(7)].map((_, i) => (
                    <div key={i} className="space-y-1">
                        <div className="h-4 w-24 rounded bg-ink/10 animate-pulse" />
                        <div className="h-10 w-full rounded-md bg-ink/10 animate-pulse" />
                    </div>
                ))}
                <div className="h-10 w-24 rounded-md bg-ink/10 animate-pulse" />
            </div>
        </div>
    )
}