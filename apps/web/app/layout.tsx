import './globals.css';
import { NotificationBell } from '../components/NotificationBell';

export const metadata = { title: 'rca-claude-code' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b bg-white px-6 py-3 flex items-center justify-between">
          <nav className="flex gap-6 text-sm">
            <a href="/analyze" className="font-medium">Analyze</a>
            <a href="/rcas">RCAs</a>
            <a href="/events">Events</a>
            <a href="/health">Health</a>
          </nav>
          <NotificationBell />
        </header>
        <main className="px-6 py-6 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
