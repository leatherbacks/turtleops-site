/**
 * Cloudflare R2 utilities for historical turtle PDFs
 */

/**
 * Get the base R2 bucket URL from environment
 */
export function getR2BucketUrl(): string | null {
  return process.env.NEXT_PUBLIC_R2_BUCKET_URL || null;
}

/**
 * Generate PDF URL for a turtle based on its name
 * PDFs may be stored with different casing (lowercase, Title Case, etc.)
 * Example: "Juniper" -> "https://bucket.r2.dev/juniper.pdf"
 */
export function getTurtlePdfUrl(turtleName: string, caseVariant: 'lower' | 'title' | 'upper' = 'lower'): string | null {
  const bucketUrl = getR2BucketUrl();
  if (!bucketUrl) return null;

  // Remove "UNNAMED-" prefix if present
  let cleanName = turtleName;
  if (cleanName.toLowerCase().startsWith('unnamed-')) {
    return null; // No PDFs for unnamed turtles
  }

  // Clean the filename (remove special characters except hyphens)
  cleanName = cleanName.replace(/[^a-zA-Z0-9-]/g, '');

  // Apply case transformation
  let filename: string;
  switch (caseVariant) {
    case 'title':
      // Title case: first letter uppercase, rest lowercase
      filename = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase();
      break;
    case 'upper':
      filename = cleanName.toUpperCase();
      break;
    case 'lower':
    default:
      filename = cleanName.toLowerCase();
      break;
  }

  return `${bucketUrl}/${filename}.pdf`;
}

/**
 * Check if R2 is configured
 */
export function isR2Configured(): boolean {
  return !!getR2BucketUrl();
}

/**
 * Check if a PDF exists for a turtle
 * Note: This requires making a HEAD request, which may have CORS limitations
 */
export async function checkPdfExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    console.error('Error checking PDF existence:', error);
    return false;
  }
}

/**
 * Find a turtle PDF by trying multiple case variations
 * Returns the first URL that exists, or null if none found
 * Tries: lowercase, Title Case, UPPERCASE
 */
export async function findTurtlePdf(turtleName: string): Promise<string | null> {
  if (!isR2Configured()) return null;

  // Try different case variations in order of likelihood
  const variants: ('lower' | 'title' | 'upper')[] = ['title', 'lower', 'upper'];

  for (const variant of variants) {
    const url = getTurtlePdfUrl(turtleName, variant);
    if (url) {
      const exists = await checkPdfExists(url);
      if (exists) {
        console.log(`Found PDF for ${turtleName} with ${variant} case: ${url}`);
        return url;
      }
    }
  }

  return null;
}
