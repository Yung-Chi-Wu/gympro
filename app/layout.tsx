import Link from 'next/link'
import { LogoutButton } from '@/components/LogoutButton'
import { BottomNav } from '@/components/BottomNav'

const NAV_LINKS = [
  { href: '/routines', label: 'Routines' },
  { href: '/metrics', label: 'Metrics' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink/10 bg-white">
        <nav className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-8">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-display text-lg uppercase tracking-wide">
              GymPro
            </Link>
            <div className="hidden sm:flex gap-4 text-sm">
              {NAV_LINKS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-ink/70 underline-offset-4 hover:text-ink hover:underline"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <LogoutButton />
        </nav>
      </header>
      <main className="flex-1 pb-20 sm:pb-0">{children}</main>
      <BottomNav links={NAV_LINKS} />
    </div>
  )
}