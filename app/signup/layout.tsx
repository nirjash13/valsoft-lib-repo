/**
 * Public signup layout — no sidebar, no topbar.
 * Renders a centered card on a canvas background.
 */
export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-12">
      {children}
    </div>
  );
}
