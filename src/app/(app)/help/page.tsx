import Link from 'next/link';
import { Card } from '@/components/ui';
import { HELP_TOPICS, HELP_TOPIC_IDS } from '@/content/help';

export const metadata = { title: 'Help — Nourish' };

/** /help — every topic with anchors; the drawer links out to here. */
export default function HelpPage() {
  return (
    <div className="space-y-4">
      <Card title="Help">
        <ul className="columns-2 gap-4 text-sm">
          {HELP_TOPIC_IDS.map((id) => (
            <li key={id} className="mb-1">
              <a href={`#${id}`} className="underline decoration-hairline underline-offset-2">
                {HELP_TOPICS[id].title}
              </a>
            </li>
          ))}
        </ul>
      </Card>
      {HELP_TOPIC_IDS.map((id) => {
        const t = HELP_TOPICS[id];
        return (
          <section key={id} id={id} className="card scroll-mt-4">
            <h2 className="mb-2 text-sm font-semibold">{t.title}</h2>
            <div className="space-y-3">
              {t.body.split('\n\n').map((para, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {para}
                </p>
              ))}
            </div>
            {t.related.length > 0 && (
              <p className="mt-3 border-t border-hairline pt-2 text-xs text-muted">
                Related:{' '}
                {t.related.map((r, i) => (
                  <span key={r}>
                    {i > 0 && ' · '}
                    <Link href={`#${r}`} className="underline">
                      {HELP_TOPICS[r].title}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
