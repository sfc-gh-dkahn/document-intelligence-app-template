/**
 * Branding. Edit the default values below (the strings after ??).
 *
 * The deployed app does not read .env files, so the NEXT_PUBLIC_* variables
 * only work for local development (npm run dev). logoUrl is a path under
 * public/, for example "/logo.png".
 */
export const THEME = {
  appName:      process.env.NEXT_PUBLIC_APP_NAME     ?? "Document Intelligence",
  appSubtitle:  process.env.NEXT_PUBLIC_APP_SUBTITLE ?? "Powered by Snowflake Cortex AI",
  brandPrimary: process.env.NEXT_PUBLIC_BRAND_COLOR  ?? "#29B5E8",
  brandDark:    process.env.NEXT_PUBLIC_BRAND_DARK   ?? "#11567F",
  brandBg:      process.env.NEXT_PUBLIC_BRAND_BG     ?? "#0A1428",
  logoUrl:      process.env.NEXT_PUBLIC_LOGO_URL     ?? "/icon.svg",
} as const

export type Theme = typeof THEME
