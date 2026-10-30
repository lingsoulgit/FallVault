import { lazy, Suspense, useMemo, useState } from 'react';
import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import type { DragEndEvent } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import {
  Folder, Inbox, Star, Hash, ChevronRight, ChevronLeft,
  Plus, Settings, Lock, Gamepad2, MessageCircle, Landmark,
  Briefcase, Sparkles, Edit3, Trash2, ShieldAlert, GripVertical
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { createFolder, updateFolder, deleteFolder, reorderFolders, createTag, updateTag, deleteTag, reorderTags } from '@/lib/db';
import { runSecurityAudit } from '@/lib/securityAudit';
import { ShinyText } from '@/components/ShinyText';
import { StrokeText } from '@/components/StrokeText';
import { ClickSpark } from '@/components/ClickSpark';
import { GlareHover } from '@/components/GlareHover';
import { SortableRow } from '@/components/SortableRow';
import { FAVORITES_VIEW_ID, TRASH_VIEW_ID } from '@/lib/constants';

const iconMap: Record<string, React.ElementType> = {
  Folder, folder: Folder,
  Inbox, inbox: Inbox,
  Star, star: Star,
  Lock, lock: Lock,
  Gamepad2, 'gamepad-2': Gamepad2,
  MessageCircle, 'message-circle': MessageCircle,
  Landmark, landmark: Landmark,
  Briefcase, briefcase: Briefcase,
  Hash, hash: Hash,
  Sparkles, sparkles: Sparkles,
};

function moveArrayItem<T>(items: T[], sourceIndex: number, targetIndex: number): T[] {
  if (sourceIndex < 0 || sourceIndex >= items.length || targetIndex < 0 || targetIndex >= items.length || sourceIndex === targetIndex) return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

const LucideIconPicker = lazy(() => import('@/components/LucideIconPicker').then((module) => ({ default: module.LucideIconPicker })));
const DynamicLucideIcon = lazy(() => import('@/components/LucideIconPicker').then((module) => ({ default: module.DynamicLucideIcon })));
const TAG_COLORS = ['#7DD3C0', '#9B8DB5', '#C0C8D8', '#D4B070', '#D47070', '#7DB8D3'];

function TagColorOptions({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const isCustomColor = !TAG_COLORS.some((color) => color.toLowerCase() === value.toLowerCase());

  return (
    <div className="flex gap-1.5 flex-wrap px-0.5">
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          aria-label={`选择颜色 ${color}`}
          aria-pressed={value.toLowerCase() === color.toLowerCase()}
          className="w-5 h-5 rounded-full transition-all"
          style={{
            background: color,
            boxShadow: value.toLowerCase() === color.toLowerCase() ? `0 0 0 2px var(--void), 0 0 0 4px ${color}` : 'none',
          }}
        />
      ))}
      <label
        className="relative w-5 h-5 rounded-full flex items-center justify-center cursor-pointer transition-all focus-within:ring-2 focus-within:ring-[var(--mint)]"
        style={{
          background: 'conic-gradient(from 0deg, #D47070, #D4B070, #7DD3C0, #7DB8D3, #9B8DB5, #D47070)',
          boxShadow: isCustomColor ? `0 0 0 2px var(--void), 0 0 0 4px ${value}` : 'none',
        }}
        title="更多颜色"
      >
        <span
          className="w-2.5 h-2.5 rounded-full border border-[rgba(255,255,255,0.7)] pointer-events-none"
          style={{ background: value }}
        />
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="选择自定义标签颜色"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </label>
    </div>
  );
}

export function Sidebar() {
  const {
    folders, tags, entries, selectedFolderId, selectedTagId, favorites, trashEntries,
    isSidebarOpen, setIsSidebarOpen, setSelectedFolderId, setFolders, setTags,
    setSelectedTagId, setSearchQuery, setIsSettingsOpen,
    setIsPasswordGeneratorOpen, setIsSecurityAuditOpen, refreshAll, setConfirmDialog
  } = useAppStore();
  const { addToast } = useToastStore();

  const isEn = useAppStore((s) => s.settings.language === 'en');
  const auditChecks = useAppStore((s) => s.settings.securityAudit);

  const auditIssues = useMemo(() => {
    try { return runSecurityAudit(entries, auditChecks).issuesCount; } catch { return 0; }
  }, [entries, auditChecks]);

  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderIcon, setNewFolderIcon] = useState('Folder');
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<number | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderIcon, setEditFolderIcon] = useState('Folder');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#7DD3C0');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [editingTag, setEditingTag] = useState<number | null>(null);
  const [editTagName, setEditTagName] = useState('');
  const [editTagColor, setEditTagColor] = useState('#7DD3C0');
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);
  const handleSidebarDragEnd = async (event: DragEndEvent) => {
    if (event.canceled) return;
    const source = event.operation.source;
    if (!isSortable(source) || source.group !== source.initialGroup || source.initialIndex === source.index) return;

    try {
      if (source.group === 'folder') {
        const orderedFolders = moveArrayItem(folders, source.initialIndex, source.index);
        setFolders(orderedFolders);
        await reorderFolders(orderedFolders.map((folder) => folder.id));
      } else if (source.group === 'tag') {
        const orderedTags = moveArrayItem(tags, source.initialIndex, source.index);
        setTags(orderedTags);
        await reorderTags(orderedTags.map((tag) => tag.id));
      } else {
        return;
      }
    } catch {
      await refreshAll();
      addToast(source.group === 'folder' ? '分类排序保存失败' : '标签排序保存失败', 'error');
    }
  };

  const handleAddFolder = async () => {
    const folderName = newFolderName.trim();
    if (!folderName) return;
    await createFolder(folderName, newFolderIcon);
    setNewFolderName('');
    setNewFolderIcon('Folder');
    setIsAddingFolder(false);
    await refreshAll();
    addToast(`分类 "${folderName}" 已创建`, 'success');
  };

  const cancelEditFolder = () => {
    setEditingFolder(null);
    setEditFolderName('');
    setEditFolderIcon('Folder');
  };

  const handleEditFolder = async (id: number) => {
    const folderName = editFolderName.trim();
    if (!folderName) return;

    await updateFolder(id, folderName, editFolderIcon);
    cancelEditFolder();
    await refreshAll();
    addToast('分类已更新', 'success');
  };

  const handleDeleteFolder = (id: number, name: string) => {
    setConfirmDialog({
      open: true,
      title: '删除分类',
      message: `确定要删除分类 "${name}" 吗？该分类下的账号将变为未分类。`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        await deleteFolder(id);
        if (selectedFolderId === id) setSelectedFolderId(null);
        await refreshAll();
        addToast('分类已删除', 'success');
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    await createTag(newTagName.trim(), newTagColor);
    setNewTagName('');
    setIsAddingTag(false);
    await refreshAll();
    addToast(`标签 "${newTagName.trim()}" 已创建`, 'success');
  };

  const cancelEditTag = () => {
    setEditingTag(null);
    setEditTagName('');
    setEditTagColor('#7DD3C0');
  };

  const handleEditTag = async (id: number) => {
    const tagName = editTagName.trim();
    if (!tagName) return;

    try {
      await updateTag(id, tagName, editTagColor);
      cancelEditTag();
      await refreshAll();
      addToast('标签已更新', 'success');
    } catch {
      addToast('标签名称已存在或更新失败', 'error');
    }
  };

  const handleDeleteTag = (id: number, name: string) => {
    setConfirmDialog({
      open: true,
      title: '删除标签',
      message: `确定要删除标签 "${name}" 吗？`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        await deleteTag(id);
        await refreshAll();
        addToast(`标签 "${name}" 已删除`, 'success');
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  // 收起状态
  if (!isSidebarOpen) {
    return (
      <GlareHover>
        <div
          className="h-full m-3 flex flex-col items-center py-4 gap-3"
          style={{
            width: '52px',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '14px',
            backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            boxShadow: '0 0 0 1px rgba(210,210,220,0.03), 0 8px 32px rgba(0,0,0,0.3)',
            animation: 'sidebarCollapse 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
        >
          {/* Logo 小图标 — 已移除 */}

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)]" />

          {/* 展开按钮 - 中间位置 */}
          <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all duration-300"
              title="展开侧边栏"
            >
              <ChevronRight size={20} />
            </button>
          </ClickSpark>

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)]" />

          {/* 常用快捷 */}
          <button
            onClick={() => { setSelectedFolderId(null); setSelectedTagId(null); setSearchQuery(''); }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="全部账号"
          >
            <Inbox size={16} />
          </button>
          <button
            onClick={() => setSelectedFolderId(FAVORITES_VIEW_ID)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="收藏夹"
          >
            <Star size={16} />
          </button>
          <button
            onClick={() => setSelectedFolderId(TRASH_VIEW_ID)}
            className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selectedFolderId === TRASH_VIEW_ID ? 'text-[var(--mint)] bg-[rgba(210,210,220,0.1)]' : 'text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)]'}`}
            title={isEn ? 'Trash' : '回收站'}
          >
            <Trash2 size={16} />
            {trashEntries.length > 0 && (
              <span className="absolute right-1 top-1 min-w-3.5 h-3.5 px-1 rounded-full text-[8px] leading-[14px] text-center font-semibold bg-[var(--danger)] text-white">
                {trashEntries.length > 99 ? '99+' : trashEntries.length}
              </span>
            )}
          </button>

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)] mt-auto" />

          <button
            onClick={() => setIsSecurityAuditOpen(true)}
            className="relative w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all mb-2"
            title={isEn ? 'Security Audit' : '安全审计'}
          >
            <ShieldAlert size={16} />
            {auditIssues > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style={{ background: '#D47070' }} />
            )}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all mb-2"
            title="设置"
          >
            <Settings size={16} />
          </button>
        </div>
      </GlareHover>
    );
  }

  return (
    <aside
      className="h-full m-3 flex flex-col overflow-hidden"
      style={{
        width: '260px',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: '14px',
        backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
        boxShadow: '0 0 0 1px rgba(210,210,220,0.03), 0 8px 32px rgba(0,0,0,0.3)',
        animation: 'sidebarExpand 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards',
      }}
    >
      {/* Logo 区域 */}
      <div className="p-4 pb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <StrokeText
            text="FallVault"
            strokeColor="#7DD3C0"
            fontSize={24}
            duration={1.4}
            className="w-full"
          />
          <p className="text-[10px] text-[var(--moon-faint)] mt-0.5">守护你的秘密钥匙</p>
        </div>
        <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="收起"
          >
            <ChevronLeft size={16} />
          </button>
        </ClickSpark>
      </div>

      {/* 魔法阵装饰线 */}
      <div className="rune-line mx-4 mb-2" />

      <DragDropProvider onDragEnd={handleSidebarDragEnd}>
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {/* 快速入口 */}
        <SidebarItem active={selectedFolderId === null && selectedTagId === null} onClick={() => { setSelectedFolderId(null); setSelectedTagId(null); setSearchQuery(''); }} icon={<Inbox size={16} />} label="全部账号" />
        <SidebarItem active={selectedFolderId === FAVORITES_VIEW_ID} onClick={() => setSelectedFolderId(FAVORITES_VIEW_ID)} icon={<Star size={16} />} label={isEn ? 'Favorites' : '收藏夹'} badge={favorites.length || undefined} />
        <SidebarItem active={selectedFolderId === TRASH_VIEW_ID} onClick={() => setSelectedFolderId(TRASH_VIEW_ID)} icon={<Trash2 size={16} />} label={isEn ? 'Trash' : '回收站'} badge={trashEntries.length || undefined} badgeColor={trashEntries.length ? '#D47070' : undefined} />

        {/* 分类 */}
        <div className="pt-3">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] text-[var(--moon-faint)] uppercase tracking-[0.2em] font-semibold">分类</span>
            <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
              <button onClick={() => setIsAddingFolder(!isAddingFolder)} className="w-5 h-5 rounded-md flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all">
                <Plus size={12} />
              </button>
            </ClickSpark>
          </div>

          {isAddingFolder && (
            <div className="px-3 py-2 space-y-2 mb-1">
              <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()} placeholder="新分类名称..." className="rune-input w-full px-3 py-1.5 text-[13px]" />
              <div>
                <Suspense fallback={<div className="h-[230px] flex items-center justify-center text-xs text-[var(--moon-faint)]">正在加载图标...</div>}>
                  <LucideIconPicker value={newFolderIcon} onChange={setNewFolderIcon} />
                </Suspense>
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddFolder} className="rune-btn rune-btn-primary px-3 py-1 text-xs">确定</button>
                <button onClick={() => { setIsAddingFolder(false); setNewFolderName(''); setNewFolderIcon('Folder'); }} className="rune-btn px-3 py-1 text-xs">取消</button>
              </div>
            </div>
          )}

          {folders.map((folder, index) => {
            const Icon = iconMap[folder.icon];
            const isEditing = editingFolder === folder.id;
            return (
              <SortableRow key={folder.id} id={`folder-${folder.id}`} index={index} group="folder" className="w-full">
                {(handleRef, isDragging) => (
              <div className="relative group" onMouseEnter={() => setHoveredItem(folder.id)} onMouseLeave={() => setHoveredItem(null)}>
                {isEditing ? (
                  <div className="px-3 py-2 space-y-2">
                    <input
                      autoFocus
                      value={editFolderName}
                      onChange={(event) => setEditFolderName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleEditFolder(folder.id);
                        if (event.key === 'Escape') cancelEditFolder();
                      }}
                      className="rune-input w-full px-2 py-1 text-[13px]"
                    />
                    <div>
                      <Suspense fallback={<div className="h-[230px] flex items-center justify-center text-xs text-[var(--moon-faint)]">正在加载图标...</div>}>
                        <LucideIconPicker value={editFolderIcon} onChange={setEditFolderIcon} />
                      </Suspense>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleEditFolder(folder.id)} className="rune-btn rune-btn-primary px-3 py-1 text-xs">保存</button>
                      <button onClick={cancelEditFolder} className="rune-btn px-3 py-1 text-xs">取消</button>
                    </div>
                  </div>
                ) : (
                  <SidebarItem
                    active={selectedFolderId === folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    icon={Icon ? <Icon size={15} /> : (
                      <Suspense fallback={<Folder size={15} />}>
                        <DynamicLucideIcon name={folder.icon} size={15} />
                      </Suspense>
                    )}
                    label={folder.name}
                    dragHandleRef={handleRef as React.Ref<HTMLSpanElement>}
                    dragLabel={isEn ? 'Drag to reorder category' : '拖动排序分类'}
                  />
                )}
                {!isEditing && hoveredItem === folder.id && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-md rounded-lg p-0.5">
                    <button onClick={(e) => { e.stopPropagation(); setEditingFolder(folder.id); setEditFolderName(folder.name); setEditFolderIcon(folder.icon); }} className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"><Edit3 size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }} className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--danger)] hover:bg-[rgba(212,112,112,0.1)] transition-all"><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
                )}
              </SortableRow>
            );
          })}
        </div>

        {/* 标签 */}
        <div className="pt-3">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] text-[var(--moon-faint)] uppercase tracking-[0.2em] font-semibold">标签</span>
            <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
              <button onClick={() => setIsAddingTag(!isAddingTag)} className="w-5 h-5 rounded-md flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all">
                <Plus size={12} />
              </button>
            </ClickSpark>
          </div>

          {isAddingTag && (
            <div className="px-3 py-2 space-y-2 mb-1">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="标签名称..." className="rune-input w-full px-3 py-1.5 text-[13px]" />
              <TagColorOptions value={newTagColor} onChange={setNewTagColor} />
              <div className="flex gap-2">
                <button onClick={handleAddTag} className="rune-btn rune-btn-primary px-3 py-1 text-xs">确定</button>
                <button onClick={() => setIsAddingTag(false)} className="rune-btn px-3 py-1 text-xs">取消</button>
              </div>
            </div>
          )}

          {tags.map((tag, index) => {
            const isEditing = editingTag === tag.id;
            return (
              <SortableRow key={tag.id} id={`tag-${tag.id}`} index={index} group="tag" className="w-full">
                {(handleRef, isDragging) => (
              <div className="relative group">
                {isEditing ? (
                  <div className="px-3 py-2 space-y-2">
                    <input
                      autoFocus
                      value={editTagName}
                      onChange={(event) => setEditTagName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') handleEditTag(tag.id);
                        if (event.key === 'Escape') cancelEditTag();
                      }}
                      className="rune-input w-full px-2 py-1 text-[13px]"
                    />
                    <TagColorOptions value={editTagColor} onChange={setEditTagColor} />
                    <div className="flex gap-2">
                      <button onClick={() => handleEditTag(tag.id)} className="rune-btn rune-btn-primary px-3 py-1 text-xs">保存</button>
                      <button onClick={cancelEditTag} className="rune-btn px-3 py-1 text-xs">取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <SidebarItem
                      active={selectedTagId === tag.id}
                      onClick={() => setSelectedTagId(tag.id)}
                      icon={<div className="w-2.5 h-2.5 rounded-full" style={{ background: tag.color }} />}
                      label={tag.name}
                      dragHandleRef={handleRef as React.Ref<HTMLSpanElement>}
                      dragLabel={isEn ? 'Drag to reorder tag' : '拖动排序标签'}
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 bg-[var(--glass-bg)] border border-[var(--glass-border)] backdrop-blur-md rounded-lg p-0.5 transition-all">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingTag(tag.id);
                          setEditTagName(tag.name);
                          setEditTagColor(tag.color);
                        }}
                        className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
                        title="编辑标签"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={(event) => { event.stopPropagation(); handleDeleteTag(tag.id, tag.name); }}
                        className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--danger)] hover:bg-[rgba(212,112,112,0.1)] transition-all"
                        title="删除标签"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </>
                )}
              </div>
                )}
              </SortableRow>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {(source) => {
          const id = String(source.id);
          const folder = id.startsWith('folder-') ? folders.find((item) => `folder-${item.id}` === id) : undefined;
          const tag = id.startsWith('tag-') ? tags.find((item) => `tag-${item.id}` === id) : undefined;
          if (!folder && !tag) return null;
          const FolderIcon = folder ? iconMap[folder.icon] : null;
          const label = folder?.name ?? tag?.name;
          return (
            <div className="pointer-events-none flex max-w-[190px] items-center gap-2 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-2 text-[13px] font-semibold text-[var(--moon)] shadow-2xl backdrop-blur-xl">
              {folder ? (FolderIcon ? <FolderIcon size={14} /> : <Folder size={14} />) : <span className="h-2.5 w-2.5 rounded-full" style={{ background: tag?.color }} />}
              <span className="truncate">{label}</span>
            </div>
          );
        }}
      </DragOverlay>
      </DragDropProvider>

      {/* 底部 */}
      <div className="p-2 pb-3 pt-3 border-t border-[rgba(192,200,216,0.06)] space-y-0.5 flex-shrink-0">
        <SidebarItem onClick={() => setIsSecurityAuditOpen(true)} icon={<ShieldAlert size={15} />} label={isEn ? 'Security Audit' : '安全审计'} badge={auditIssues || undefined} badgeColor={auditIssues ? '#D47070' : undefined} />
        <SidebarItem onClick={() => setIsPasswordGeneratorOpen(true)} icon={<Sparkles size={15} />} label="密码生成器" />
        <SidebarItem onClick={() => setIsSettingsOpen(true)} icon={<Settings size={15} />} label="设置" />
      </div>
    </aside>
  );
}

function SidebarItem({ active, onClick, icon, label, badge, badgeColor, dragHandleRef, dragLabel }: {
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  badgeColor?: string;
  dragHandleRef?: React.Ref<HTMLSpanElement>;
  dragLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`group w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-200 ${active ? 'bg-[rgba(210,210,220,0.1)] text-[var(--mint)] shadow-[0_0_12px_rgba(210,210,220,0.1)]' : 'text-[var(--moon-dim)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.05)]'}`}
    >
      {dragHandleRef && (
        <span
          ref={dragHandleRef}
          onClick={(event) => event.stopPropagation()}
          className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-[var(--moon-faint)] opacity-60 transition-all group-hover:bg-[rgba(210,210,220,0.06)] group-hover:opacity-90 hover:!opacity-100 active:cursor-grabbing"
          title={dragLabel}
          aria-label={dragLabel}
        >
          <GripVertical size={12} />
        </span>
      )}
      <span className={active ? 'text-[var(--mint)]' : 'text-[var(--moon-faint)]'}>{icon}</span>
      <span className="text-[13px] font-semibold flex-1 text-left">{label}</span>
      {badge !== undefined && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${badgeColor || 'var(--mint)'}22`, color: badgeColor || 'var(--mint)' }}>{badge}</span>}
    </button>
  );
}
