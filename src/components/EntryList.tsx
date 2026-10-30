import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import type { DragEndEvent } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { EntryCard } from './EntryCard';
import { SortableRow } from './SortableRow';
import { Lock, Loader2 } from 'lucide-react';
import { RecycleBin } from './RecycleBin';
import { FAVORITES_VIEW_ID, TRASH_VIEW_ID } from '@/lib/constants';
import { reorderEntries } from '@/lib/db';

function reorderVisibleItems<T extends { id: number }>(allItems: T[], visibleBefore: T[], visibleAfter: T[]): T[] {
  const visibleIds = new Set(visibleBefore.map((item) => item.id));
  let nextIndex = 0;
  return allItems.map((item) => visibleIds.has(item.id) ? visibleAfter[nextIndex++] ?? item : item);
}

export function EntryList() {
  const {
    entries, isLoading, searchQuery, selectedFolderId, favorites,
    setEntries, setFavorites, refreshAll,
  } = useAppStore();
  const { addToast } = useToastStore();

  const displayEntries = selectedFolderId === FAVORITES_VIEW_ID ? favorites : entries;

  const handleDragEnd = async (event: DragEndEvent) => {
    if (event.canceled) return;
    const source = event.operation.source;
    if (!isSortable(source) || source.initialIndex === source.index) return;

    const orderedEntries = [...displayEntries];
    const [movedEntry] = orderedEntries.splice(source.initialIndex, 1);
    orderedEntries.splice(source.index, 0, movedEntry);
    if (selectedFolderId === FAVORITES_VIEW_ID) {
      setFavorites(orderedEntries);
      setEntries(reorderVisibleItems(entries, displayEntries, orderedEntries));
    } else {
      setEntries(orderedEntries);
      const visibleFavoritesBefore = displayEntries.filter((entry) => entry.is_favorite);
      const visibleFavoritesAfter = orderedEntries.filter((entry) => entry.is_favorite);
      setFavorites(reorderVisibleItems(favorites, visibleFavoritesBefore, visibleFavoritesAfter));
    }
    try {
      await reorderEntries(orderedEntries.map((entry) => entry.id));
    } catch {
      await refreshAll();
      addToast('账号排序保存失败', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--mint)' }} />
        <span className="text-sm text-[var(--moon-faint)]">加载中...</span>
      </div>
    );
  }

  if (selectedFolderId === TRASH_VIEW_ID) {
    return <RecycleBin />;
  }

  if (displayEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--moon-faint)]" style={{ opacity: 0.6 }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: 'rgba(192, 200, 216, 0.06)' }}>
          <Lock size={32} style={{ color: 'var(--moon-faint)' }} />
        </div>
        <p className="text-base font-medium text-[var(--moon-dim)]">
          {searchQuery ? '没有找到匹配的账号' : '还没有保存任何账号'}
        </p>
        <p className="text-sm mt-2 text-[var(--moon-faint)]">
          {searchQuery ? '换个关键词试试看~' : '点击右上角 "+" 开始添加吧'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {searchQuery && (
        <div className="text-sm text-[var(--moon-faint)] px-1 pb-3">
          {displayEntries.length > 0
            ? `找到 ${displayEntries.length} 个匹配结果`
            : '没有找到匹配的账号'}
        </div>
      )}
      <DragDropProvider onDragEnd={handleDragEnd}>
        <div className="grid auto-rows-[160px] grid-cols-1 items-stretch gap-3 pb-20 md:grid-cols-2 xl:grid-cols-3">
          {displayEntries.map((entry, i) => (
            <SortableRow key={entry.id} id={entry.id} index={i} className="fade-up h-full">
              {(handleRef) => (
                <EntryCard
                  entry={entry}
                  index={i}
                  dragHandleRef={handleRef as React.Ref<HTMLButtonElement>}
                />
              )}
            </SortableRow>
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
          {(source) => {
            const entry = displayEntries.find((item) => item.id === source.id);
            return entry ? (
              <div className="pointer-events-none rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 text-sm font-semibold text-[var(--moon)] shadow-2xl backdrop-blur-xl">
                {entry.title}
              </div>
            ) : null;
          }}
        </DragOverlay>
      </DragDropProvider>
    </div>
  );
}
