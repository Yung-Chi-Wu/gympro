export function toFriendlyError(
    error: { message: string; code?: string } | null | undefined,
    language = 'en'
): string {
    const zh = language === 'zh-TW'

    if (!error) return zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.'

    if (error.code === '23505') {
        return zh ? '已經存在——請換一個名稱。' : 'That already exists — try a different name.'
    }
    if (error.code === '23514') {
        return zh ? '輸入的數值超出允許範圍。' : 'One of the values entered is out of the allowed range.'
    }
    if (error.code === '23503') {
        return zh ? '找不到這個項目，請重新整理頁面。' : 'That item no longer exists — try refreshing the page.'
    }

    return zh ? '發生錯誤，請再試一次。' : 'Something went wrong. Please try again.'
}