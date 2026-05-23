/**
 * Access-denied layout — no sidebar, no topbar, no session check.
 * Renders a centered card on a canvas background.
 */
export default function AccessDeniedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 py-12">
      {children}
    </div>
  );
}
