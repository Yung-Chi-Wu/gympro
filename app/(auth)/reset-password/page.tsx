import { getLocale } from 'next-intl/server'
import { LangToggle } from '@/components/LangToggle'
import { ForgotPasswordForm } from '@/components/ForgotPasswordForm'

export default async function ForgotPasswordPage() {
    const locale = await getLocale()

    return (
        <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
            <div className="flex justify-end p-4">
                <LangToggle currentLocale={locale} />
            </div>
            <div className="flex flex-1 items-center justify-center px-4">
                <ForgotPasswordForm locale={locale} />
            </div>
        </div>
    )
}