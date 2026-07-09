export function errorMessage(
    error: any,
    fallback = "Something went wrong",
): string {
    return (
        error?.response?.data?.error ??
        error?.response?.data?.message ??
        error?.message ??
        fallback
    );
}
