'use client';

/**
 * Help drawer: HelpProvider (context) + HelpButton (fixed bottom-right) + InfoDot
 * (tap-to-open beside metric labels — hover tooltips are useless on a phone; the
 * title attribute stays as a desktop nicety). Content lives in src/content/help.ts;
 * the /help page renders the same topics with anchors.
 */
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Modal } from '@/components/ui';
import { HELP_TOPICS, HelpTopicId } from '@/content/help';

interface HelpContextValue {
  openTopic: (topic: HelpTopicId) => void;
  setDefaultTopic: (topic: HelpTopicId) => void;
  open: () => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [topic, setTopic] = useState<HelpTopicId>('what-nourish-is');
  const [isOpen, setIsOpen] = useState(false);

  const openTopic = useCallback((t: HelpTopicId) => {
    setTopic(t);
    setIsOpen(true);
  }, []);
  const setDefaultTopic = useCallback((t: HelpTopicId) => setTopic(t), []);
  const open = useCallback(() => setIsOpen(true), []);

  const entry = HELP_TOPICS[topic];

  return (
    <HelpContext.Provider value={{ openTopic, setDefaultTopic, open }}>
      {children}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title={entry.title}>
        <div className="space-y-3">
          {entry.body.split('\n\n').map((para, i) => (
            <p key={i} className="text-sm leading-relaxed">
              {para}
            </p>
          ))}
          {entry.related.length > 0 && (
            <p className="border-t border-hairline pt-2 text-xs text-muted">
              Related:{' '}
              {entry.related.map((r, i) => (
                <span key={r}>
                  {i > 0 && ' · '}
                  <button className="underline hover:text-ink" onClick={() => setTopic(r)}>
                    {HELP_TOPICS[r].title}
                  </button>
                </span>
              ))}
            </p>
          )}
          <p className="text-xs text-muted">
            <Link href="/help" className="underline" onClick={() => setIsOpen(false)}>
              All help topics
            </Link>
          </p>
        </div>
      </Modal>
    </HelpContext.Provider>
  );
}

function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error('useHelp must be used within HelpProvider');
  return ctx;
}

/** Per-page default topic for the drawer, e.g. useHelpTopic('week-success') on the dashboard. */
export function useHelpTopic(topic: HelpTopicId) {
  const { setDefaultTopic } = useHelp();
  useEffect(() => setDefaultTopic(topic), [topic, setDefaultTopic]);
}

export function HelpButton() {
  const { open } = useHelp();
  return (
    <button
      onClick={open}
      aria-label="Help"
      className="fixed bottom-4 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-card text-sm font-semibold text-muted shadow-sm hover:text-ink"
      style={{
        bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        right: 'calc(1rem + env(safe-area-inset-right, 0px))',
      }}
    >
      ?
    </button>
  );
}

/** Tap-to-open info dot beside a metric label. */
export function InfoDot({ topic }: { topic: HelpTopicId }) {
  const { openTopic } = useHelp();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openTopic(topic);
      }}
      aria-label={`About: ${HELP_TOPICS[topic].title}`}
      title={HELP_TOPICS[topic].title}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-wash align-middle text-[10px] font-semibold text-muted hover:text-ink"
    >
      i
    </button>
  );
}
