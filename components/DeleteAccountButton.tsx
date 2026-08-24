'use client'

import { useState } from 'react'
import { deleteAccount } from '@/app/(app)/settings/delete-account-action'

interface DeleteAccountButtonProps {
    isZhTW: boolean
}

export function DeleteAccountButton({ isZhTW }: DeleteAccountButtonProps) {
    const [showConfirm, setShowConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleDelete() {
        setIsDeleting(true)
        setError(null)

        // 直接呼叫 server action，裡面會自己處理登出
        const result = await deleteAccount()

        if (!result.success) {
            setError(result.error ?? 'Something went wrong.')
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
            <div className="pt-4 border-t border-red-100">
                <button
                    type="button"
                    onClick={() => setShowConfirm(true)}
                    className="text-sm text-red-500 hover:text-red-700 underline transition-colors"
                >
                    {isZhTW ? '刪除帳號' : 'Delete Account'}
                </button>
            </div>

            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 space-y-4 shadow-xl">
                        <h3 className="text-lg font-bold text-red-600">
                            {isZhTW ? '確定要刪除帳號？' : 'Delete your account?'}
                        </h3>
                        <p className="text-sm text-black/60">
                            {isZhTW
                                ? '這個操作無法復原。你的所有訓練紀錄、課表、AI 報告都會永久刪除。'
                                : 'This cannot be undone. All your workouts, routines, and AI reports will be permanently deleted.'}
                        </p>

                        {error && <p className="text-sm text-red-600">{error}</p>}

                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setShowConfirm(false)}
                                disabled={isDeleting}
                                className="flex-1 rounded-md border px-4 py-2 text-sm text-black/60 disabled:opacity-50"
                            >
                                {isZhTW ? '取消' : 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={handleDelete}
                                disabled={isDeleting}
                                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                                {isDeleting
                                    ? (isZhTW ? '刪除中...' : 'Deleting...')
                                    : (isZhTW ? '確認刪除' : 'Delete')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}