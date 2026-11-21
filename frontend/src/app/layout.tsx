import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Providers, ClerkProviders } from "@/components/providers";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "bvbtips — A better game starts with feedback",
    template: "%s · bvbtips",
  },
  description:
    "Thoughtful feedback. Clear progress. A space for athletes to grow together.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <ClerkProvider
            signInUrl="/login"
            signUpUrl="/signup"
            signInFallbackRedirectUrl="/matches"
            signUpFallbackRedirectUrl="/onboarding"
          >
            <ClerkProviders>{children}</ClerkProviders>
          </ClerkProvider>
        ) : (
          <Providers>{children}</Providers>
        )}
      </body>
    </html>
  );
}
