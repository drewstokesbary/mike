/** Upload files one at a time and preserve their selected order. */
export async function uploadFilesSequentially<T>(
    files: readonly File[],
    upload: (file: File) => Promise<T>,
): Promise<T[]> {
    const uploaded: T[] = [];
    for (const file of files) uploaded.push(await upload(file));
    return uploaded;
}

/** Sequential equivalent of Promise.allSettled for independent uploads. */
export async function uploadFilesSequentiallySettled<T>(
    files: readonly File[],
    upload: (file: File) => Promise<T>,
): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = [];
    for (const file of files) {
        try {
            results.push({ status: "fulfilled", value: await upload(file) });
        } catch (reason) {
            results.push({ status: "rejected", reason });
        }
    }
    return results;
}
