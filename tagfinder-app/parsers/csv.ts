import Papa from 'papaparse';

/** Parse a CSV file and return the header row + data rows */
export function parseCSV(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const headers = results.meta.fields || [];
        const rows = results.data as Record<string, string>[];
        resolve({ headers, rows });
      },
      error(err) {
        reject(err);
      },
    });
  });
}
