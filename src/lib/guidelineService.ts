import { prisma } from '@/lib/prisma';

export async function getSectionWithCurrent(slug: string) {
  const section = await prisma.guidelineSection.findUnique({
    where: { slug },
    include: {
      revisions: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { author: { select: { name: true } } },
      },
    },
  });
  if (!section) return null;
  const current = section.revisions[0] ?? null;
  return { section, current };
}

export async function serializeSection(slug: string) {
  const found = await getSectionWithCurrent(slug);
  if (!found) return null;
  const { section, current } = found;
  let editedBy: string | null = null;
  if (current) {
    if (current.tokenId) {
      const token = await prisma.apiToken.findUnique({
        where: { id: current.tokenId },
        select: { name: true },
      });
      editedBy = token?.name ?? 'revoked token';
    } else {
      editedBy = current.author?.name ?? null;
    }
  }
  return {
    slug: section.slug,
    title: section.title,
    sortOrder: section.sortOrder,
    body: current?.body ?? '',
    links: (current?.links as { label: string; nutrients: string[] }[] | null) ?? [],
    editedBy,
    editedAt: current?.createdAt.toISOString() ?? null,
    revisionId: current?.id ?? null,
  };
}

/**
 * Append-or-replace a `## heading` block in a Markdown body.
 * Replaces from the matching `## heading` line up to (not including) the next `## `
 * heading, or appends a new block at the end.
 */
export function patchHeadingBlock(body: string, heading: string, content: string): string {
  const lines = body.split('\n');
  const target = heading.trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.*)$/);
    if (m && m[1].trim().toLowerCase() === target) {
      start = i;
      break;
    }
  }
  const block = `## ${heading.trim()}\n\n${content.trim()}`;
  if (start === -1) {
    const trimmed = body.replace(/\s+$/, '');
    return trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const beforeLines = lines.slice(0, start).join('\n').replace(/\s+$/, '');
  const afterLines = lines.slice(end).join('\n').replace(/^\s+/, '');
  const parts = [beforeLines, block, afterLines].filter((p) => p.length > 0);
  return `${parts.join('\n\n')}\n`;
}
