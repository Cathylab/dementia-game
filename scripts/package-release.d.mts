export const FOLDER: string;
export function releaseFiles(root?: string): Promise<Map<string, string>>;
export function packageRelease(outFile: string, root?: string): Promise<{ outFile: string; files: number; bytes: number }>;
