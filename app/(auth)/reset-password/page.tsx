import { getLocale } from 'next-intl/server'
import { ResetPasswordForm } from '@/components/ResetPasswordForm'

export default async function ResetPasswordPage() {
    const locale = await getLocale()

    return (
        <div className="flex min-h-screen items-center justify-center px-4">
            <ResetPasswordForm locale={locale} />
        </div>
    )
}