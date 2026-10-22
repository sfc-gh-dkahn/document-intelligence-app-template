import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { PageAccessGuard } from "@/components/page-access-guard"
import { ToastProvider } from "@/components/toast"
import { RoleProvider } from "@/hooks/use-role"
import { THEME } from "@/theme.config"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: `${THEME.appName} — ${THEME.appSubtitle}`,
  description: `AI-powered document intelligence for ${THEME.appSubtitle.toLowerCase()}`,
  icons: { icon: THEME.logoUrl },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inject brand CSS variables so all var(--brand-*) references resolve */}
        <style dangerouslySetInnerHTML={{ __html: `
          :root {
            --brand-primary: ${THEME.brandPrimary};
            --brand-dark:    ${THEME.brandDark};
            --brand-bg:      ${THEME.brandBg};
          }
        `}} />
        {/* Prevent flash of wrong theme on load */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var t = localStorage.getItem('doc_intel_theme');
            if (t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('dark');
            }
          })();
        `}} />
      </head>
      <body className={inter.className}>
        <RoleProvider>
          <ToastProvider>
            <div className="flex h-screen overflow-hidden">
              <AppSidebar />
              <div className="flex-1 flex flex-col overflow-hidden">
                <AppHeader />
                <main className="flex-1 overflow-auto bg-slate-50 p-6">
                  <PageAccessGuard>{children}</PageAccessGuard>
                </main>
              </div>
            </div>
          </ToastProvider>
        </RoleProvider>
      </body>
    </html>
  )
}
