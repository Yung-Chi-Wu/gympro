// Supabase/Postgres error messages often leak internal details (table
// names, constraint names, SQL keywords). Never show error.message
// directly to the user — map known cases to plain language, and fall
// back to a generic message for everything else.
export function toFriendlyError(error: { message: string; code?: string } | null | undefined): string {
    if (!error) return 'Something went wrong. Please try again.'

    // Postgres unique-violation code
    if (error.code === '23505') {
        return 'That already exists — try a different name.'
    }
    // Postgres check-constraint-violation code
    if (error.code === '23514') {
        return 'One of the values entered is out of the allowed range.'
    }
    // Postgres foreign-key-violation code
    if (error.code === '23503') {
        return 'That item no longer exists — try refreshing the page.'
    }

    return 'Something went wrong. Please try again.'
}