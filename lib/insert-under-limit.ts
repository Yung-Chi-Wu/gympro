// A limit on how many rows a user adds in a time window that holds under a burst of parallel
// requests. Counting first and inserting after lets every request of a burst count the same rows
// and all go in. So the row goes in first, then the window is counted with it, and a row that took
// the count past the limit is deleted again. Each row kept was counted with every row kept before
// it, so no more than max stay; in a burst, some under the limit may be refused as well.

type Failure = { message: string } | null

export interface UnderLimit {
    /** Inserts the row and answers its id */
    insert: () => PromiseLike<{ data: { id: string } | null; error: Failure }>
    /** How many rows the window holds, the new one included */
    count: () => PromiseLike<{ count: number | null; error: Failure }>
    /** Deletes the row with this id */
    remove: (id: string) => PromiseLike<{ error: Failure }>
    max: number
}

/** saved, limit (the row was taken out again), or what failed. A row that couldn't be counted is taken out too. */
export async function insertUnderLimit({ insert, count, remove, max }: UnderLimit): Promise<'saved' | 'limit' | { error: string }> {
    const { data, error } = await insert()
    if (error || !data) return { error: error?.message ?? 'Not saved' }
    const counted = await count()
    if (!counted.error && (counted.count ?? 0) <= max) return 'saved'
    const { error: removeError } = await remove(data.id)
    if (counted.error) return { error: counted.error.message }
    return removeError ? { error: removeError.message } : 'limit'
}
