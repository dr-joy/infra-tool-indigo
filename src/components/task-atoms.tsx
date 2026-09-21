// Các "atom" UI dùng lại khắp nơi (badge link, nút copy note, icon sort...).
// Tách khỏi main.tsx để mọi màn hình dùng chung.
import React, { useState } from 'react';
import {
  ArrowDownUp, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Copy,
  FileSpreadsheet, Github, Plus, Trash2
} from 'lucide-react';
import { useLang } from '../useLang';
import type { SortState, TaskLink, TaskLinkType, TruongSort } from '../types';
import { maxTaskLinks, normalizedTaskLinks, taskLinkHref, taskLinkTypeLabels } from '../lib/task-utils';

export function CopyNoteButton({ text }: { text?: string | null }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(text?.trim());

  async function copyNote(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!canCopy) return;
    await navigator.clipboard.writeText(text || '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      className="note-copy-btn"
      disabled={!canCopy}
      onClick={copyNote}
      title={copied ? t('note.copied') : t('note.copy')}
      aria-label={copied ? t('note.copied') : t('note.copy')}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function TaskLinkIcon({ type }: { type: TaskLinkType }) {
  if (type === 'chat') return <span className="task-link-drjoy">Dr.Joy</span>;
  if (type === 'file') return <FileSpreadsheet size={14} />;
  if (type === 'release') return <span className="task-link-r">R</span>;
  if (type === 'zoom') return <span className="task-link-z">Z</span>;
  return <Github size={14} />;
}

export function TaskLinkBadges({ links, variant = 'inline' }: { links?: TaskLink[]; variant?: 'inline' | 'timeline' }) {
  const usableLinks = normalizedTaskLinks(links || []);
  if (usableLinks.length === 0) return null;

  const totals = usableLinks.reduce<Record<TaskLinkType, number>>((counts, link) => {
    counts[link.type] += 1;
    return counts;
  }, { chat: 0, file: 0, git: 0, release: 0, zoom: 0 });
  const seen = { chat: 0, file: 0, git: 0, release: 0, zoom: 0 };

  return (
    <div className={`task-link-badges task-link-badges-${variant}`} onClick={(event) => event.stopPropagation()}>
      {usableLinks.map((link, index) => {
        seen[link.type] += 1;
        const order = seen[link.type];
        return (
          <a
            key={`${link.type}-${link.url}-${index}`}
            className={`task-link-badge task-link-${link.type}`}
            href={taskLinkHref(link.url)}
            target="_blank"
            rel="noreferrer"
            title={`${taskLinkTypeLabels[link.type]}${totals[link.type] > 1 ? ` ${order}` : ''}: ${link.url}`}
            aria-label={`${taskLinkTypeLabels[link.type]}${totals[link.type] > 1 ? ` ${order}` : ''}`}
          >
            <TaskLinkIcon type={link.type} />
            {totals[link.type] > 1 && <span>{order}</span>}
          </a>
        );
      })}
    </div>
  );
}

export function TaskLinkEditor({
  links,
  onChange
}: {
  links: TaskLink[];
  onChange: (links: TaskLink[]) => void;
}) {
  const { t } = useLang();
  const canAddLink = links.length < maxTaskLinks;

  function addLink(type: TaskLinkType) {
    if (!canAddLink) return;
    onChange([...links, { type, url: '' }]);
  }

  function updateLink(index: number, patch: Partial<TaskLink>) {
    onChange(links.map((link, currentIndex) => currentIndex === index ? { ...link, ...patch } : link));
  }

  function removeLink(index: number) {
    onChange(links.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <div className="task-link-editor">
      <div className="task-link-editor-actions">
        {(Object.keys(taskLinkTypeLabels) as TaskLinkType[]).map((type) => (
          <button key={type} type="button" className="nut-chinh" disabled={!canAddLink} onClick={() => addLink(type)}>
            <Plus size={14} />
            {taskLinkTypeLabels[type]}
          </button>
        ))}
      </div>
      <div className="task-link-editor-list">
        {links.map((link, index) => (
          <div key={index} className="task-link-editor-row">
            <select value={link.type} onChange={(event) => updateLink(index, { type: event.target.value as TaskLinkType })}>
              {(Object.keys(taskLinkTypeLabels) as TaskLinkType[]).map((type) => (
                <option key={type} value={type}>{taskLinkTypeLabels[type]}</option>
              ))}
            </select>
            <input
              value={link.url}
              onChange={(event) => updateLink(index, { url: event.target.value })}
              placeholder="https://..."
            />
            <button type="button" className="nut-icon nut-trash-icon" onClick={() => removeLink(index)} title={t('btn.delete_link')}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SortIcon({ sort, truong }: { sort: SortState | null; truong: TruongSort }) {
  if (sort?.truong !== truong) return <ArrowDownUp size={14} />;
  return sort.huong === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />;
}
