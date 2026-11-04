'use client'

import { useId, useState } from 'react'
import { deleteAccount } from '@/app/(app)/settings/delete-account-action'
import { serverWrite } from '@/lib/data-version'
import { toFriendlyError } from '@/lib/friendly-error'
import { BUTTON } from '@/lib/ui'
import { Sheet } from './Sheet'

interface DeleteAccountButtonProps {
    isZhTW: boolean
    /** The classes of the button that opens the confirmation */
    className?: string
}

export function DeleteAccountButton({ isZhTW, className = 'text-sm text-red-500 hover:text-red-700 underline transition-colors' }: DeleteAccountButtonProps) {
    const [showConfirm, setShowConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const titleId = useId()

    async function handleDelete() {
        setIsDeleting(true)
        setError(null)

        // 直接呼叫 server action，裡面會自己處理登出
        const result = await serverWrite(() => deleteAccount())

        if (!result.success) {
            setError(result.error === 'not_signed_in'
                ? (isZhTW ? '登入已過期，請重新登入後再試一次。' : 'Your sign-in has expired. Log in again, then try once more.')
                : toFriendlyError(null, isZhTW ? 'zh-TW' : 'en'))
            setIsDeleting(false)
            return
        }

        // 清掉 localStorage
        localStorage.clear()

        // 導向歡迎頁
        window.location.href = '/'
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setShowConfirm(true)}
                className={className}
            >
                {isZhTW ? '刪除帳號' : 'Delete Account'}
            </button>

            {showConfirm && (
                // Closing it is Cancel. Only the button that deletes is red, as in Coach G's redesign warning
                <Sheet labelledBy={titleId} onClose={() => setShowConfirm(false)} centered>
                    <div className="space-y-4">
                        <h3 id={titleId} className="text-lg font-bold">
                            {isZhTW ? '確定要刪除帳號？' : 'Delete your account?'}
                        </h3>
                        <p className="text-sm text-muted">
                            {isZhTW
                                ? '這個操作無法復原。你的所有訓練紀錄、課表、AI 報告都會永久刪除。'
                                : 'This cannot be undone. All your workouts, routines, and AI reports will be permanently deleted.'}
                        </p>

                        {error && <p className="text-sm text-miss">{error}</p>}

                        {/* On a phone the two are stacked full width, the delete on top; side by side from md */}
                        <div className="flex flex-col-reverse gap-2 md:flex-row">
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                disabled={isDeleting}
                                className={`${BUTTON.secondary} md:flex-1`}
                            >
                                {isZhTW ? '取消' : 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className={`${BUTTON.dangerConfirm} md:flex-1`}
                            >
                                {isDeleting
                                    ? (isZhTW ? '刪除中...' : 'Deleting...')
                                    : (isZhTW ? '確認刪除' : 'Delete')}
                            </button>
                        </div>
                    </div>
                </Sheet>
            )}
        </>
    )
}