import { getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ThemeProvider } from '@/components/ThemeProvider'

export default async function ForgotPasswordPage() {
    const locale = await getLocale()

    return (
        <ThemeProvider>
            <div className="flex min-h-screen flex-col bg-[#FAFAF8] dark:bg-[#1A1814]">
                <div className="flex justify-end items-center gap-3 p-4">
                    <ThemeToggle />
                    <LangToggle currentLocale={locale} />
                </div>
                <div className="flex flex-1 items-center justify-center px-4">
                    <ForgotPasswordForm locale={locale} />
                </div>
            </div>
        </ThemeProvider>
    )
}