import { Clock3, Lock, RotateCcw, Trash2 } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { permanentlyDeleteEntry, restoreEntry } from '@/lib/db';
import type { Entry } from '@/types';

export function RecycleBin() {
  const { trashEntries, refreshAll, setConfirmDialog } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = useAppStore((state) => state.settings.language === 'en');

  const handleRestore = async (entry: Entry) => {
    try {
      await restoreEntry(entry.id);
      await refreshAll();
      addToast(
        isEn ? `Restored "${entry.title}"` : `已恢复「${entry.title}」`,
        'success'
      );
    } catch {
      addToast(isEn ? 'Restore failed' : '恢复失败，请重试', 'error');
    }
  };

  const handlePermanentDelete = (entry: Entry) => {
    setConfirmDialog({
      open: true,
      title: isEn ? 'Delete permanently' : '永久删除',
      message: isEn
        ? `Permanently delete "${entry.title}"? Attachments and password history will also be deleted. This cannot be undone.`
        : `确定要永久删除「${entry.title}」吗？附件和密码历史也会被删除，此操作无法恢复。`,
      confirmText: isEn ? 'Delete permanently' : '永久删除',
      onConfirm: async () => {
        try {
          await permanentlyDeleteEntry(entry.id);
          await refreshAll();
          addToast(isEn ? 'Account permanently deleted' : '账号已永久删除', 'success');
        } catch {
          addToast(isEn ? 'Delete failed' : '删除失败，请重试', 'error');
        }
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  if (trashEntries.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-[var(--moon-faint)]" style={{ opacity: 0.72 }}>
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(192, 200, 216, 0.06)' }}>
          <Trash2 size={30} />
        </div>
        <p className="text-base font-medium text-[var(--moon-dim)]">
          {isEn ? 'Trash is empty' : '回收站是空的'}
        </p>
        <p className="mt-2 text-sm text-[var(--moon-faint)]">
          {isEn ? 'Deleted accounts will appear here' : '删除的账号会暂存在这里'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 pb-20 md:grid-cols-2 xl:grid-cols-3">
      {trashEntries.map((entry, index) => (
        <article
          key={entry.id}
          className="rune-panel fade-up flex min-h-[160px] flex-col p-4"
          style={{ animationDelay: `${index * 0.04}s`, animationFillMode: 'both' }}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[rgba(192,200,216,0.08)] text-[var(--moon-dim)]">
              <Lock size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-[var(--moon)]">{entry.title}</h3>
              <p className="mt-1 truncate text-xs text-[var(--moon-dim)]">
                {entry.username || entry.website || (isEn ? 'No account details' : '无账号信息')}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--moon-faint)]">
            <Clock3 size={12} />
            <span>
              {isEn ? 'Deleted ' : '删除于 '}
              {formatDeletedAt(entry.deleted_at, isEn)}
            </span>
          </div>

          <div className="mt-auto flex items-center gap-2 pt-3">
            <button
              type="button"
              onClick={() => handleRestore(entry)}
              className="rune-btn flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--mint)]"
            >
              <RotateCcw size={13} />
              {isEn ? 'Restore' : '恢复'}
            </button>
            <button
              type="button"
              onClick={() => handlePermanentDelete(entry)}
              className="rune-btn flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[var(--danger)]"
            >
              <Trash2 size={13} />
              {isEn ? 'Delete' : '永久删除'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function formatDeletedAt(value: string | null | undefined, isEn: boolean): string {
  if (!value) return isEn ? 'recently' : '刚刚';
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(isEn ? 'en' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}
