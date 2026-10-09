// While 設定 loads: the sections and a form side by side, the grouped list on a phone
export default function SettingsLoading() {
    return (
        <div className="space-y-4">
            <div className="h-8 w-24 rounded-lg bg-ink/10 animate-pulse max-md:hidden" />
            <div className="gap-4 @split:grid @split:grid-cols-[200px_minmax(0,1fr)]">
                <div className="hidden h-52 rounded-[14px] border border-line bg-card @split:block" />
                <div className="max-w-xl space-y-4 rounded-[14px] border border-line bg-card p-4">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="space-y-1.5">
                            <div className="h-3 w-20 rounded bg-ink/10 animate-pulse" />
                            <div className="h-10 w-full rounded-[9px] bg-ink/10 animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
