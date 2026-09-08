import { useMemo, useRef, useState } from 'react';
import { Folder, icons, Search } from 'lucide-react';

type IconName = keyof typeof icons;

const ICON_COLUMNS = 5;
const ICON_ROW_HEIGHT = 38;
const ICON_VIEWPORT_HEIGHT = 152;
const ICON_NAMES = (Object.keys(icons) as IconName[]).sort((a, b) => a.localeCompare(b));
const ICON_NAMES_BY_COMPACT_NAME = new Map(
  ICON_NAMES.map((name) => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), name] as const),
);

function resolveIconName(name: string): IconName | null {
  if (name in icons) return name as IconName;
  const compactName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ICON_NAMES_BY_COMPACT_NAME.get(compactName) ?? null;
}

export function DynamicLucideIcon({ name, size = 16, className }: {
  name: string;
  size?: number;
  className?: string;
}) {
  const resolvedName = resolveIconName(name);
  if (!resolvedName) return <Folder size={size} className={className} aria-hidden="true" />;

  const Icon = icons[resolvedName];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

export function LucideIconPicker({ value, onChange }: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [previewIconName, setPreviewIconName] = useState<IconName | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedIconName = resolveIconName(value);

  const filteredIconNames = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalizedQuery) return ICON_NAMES;
    return ICON_NAMES.filter((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedQuery));
  }, [query]);

  const rowCount = Math.ceil(filteredIconNames.length / ICON_COLUMNS);
  const startRow = Math.max(0, Math.floor(scrollTop / ICON_ROW_HEIGHT) - 2);
  const endRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + ICON_VIEWPORT_HEIGHT) / ICON_ROW_HEIGHT) + 2,
  );

  const handleSearch = (nextQuery: string) => {
    setQuery(nextQuery);
    setScrollTop(0);
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-0.5 text-[10px] font-medium text-[var(--moon)]">
        <span>选择图标</span>
        <span>
          {filteredIconNames.length === ICON_NAMES.length
            ? `${ICON_NAMES.length} 个图标`
            : `${filteredIconNames.length} / ${ICON_NAMES.length}`}
        </span>
      </div>

      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--moon-faint)] pointer-events-none" />
        <input
          value={query}
          onChange={(event) => handleSearch(event.target.value)}
          placeholder="搜索图标（英文名称）..."
          aria-label="搜索分类图标"
          className="rune-input w-full pl-8 pr-2 py-1.5 text-xs"
        />
      </div>

      <div className={`min-h-[26px] rounded-md px-1.5 py-1 flex items-center justify-center text-center text-[10px] leading-tight break-all bg-[rgba(210,210,220,0.05)] ${previewIconName ? 'font-semibold text-[var(--moon)]' : 'text-[var(--moon-dim)]'}`}>
        {previewIconName ? `图标名：${previewIconName}` : '鼠标悬停图标可查看完整英文名称'}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="relative overflow-y-auto rounded-lg border border-[var(--glass-border)] bg-[rgba(210,210,220,0.04)] px-1"
        style={{ height: ICON_VIEWPORT_HEIGHT }}
      >
        {filteredIconNames.length ? (
          <div className="relative" style={{ height: rowCount * ICON_ROW_HEIGHT }}>
            {Array.from({ length: endRow - startRow }, (_, rowOffset) => {
              const rowIndex = startRow + rowOffset;
              const rowIcons = filteredIconNames.slice(
                rowIndex * ICON_COLUMNS,
                rowIndex * ICON_COLUMNS + ICON_COLUMNS,
              );

              return (
                <div
                  key={rowIndex}
                  className="absolute left-0 right-0 grid grid-cols-5 gap-1.5"
                  style={{ top: rowIndex * ICON_ROW_HEIGHT, height: 32 }}
                >
                  {rowIcons.map((iconName) => (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => { onChange(iconName); setPreviewIconName(iconName); }}
                      onMouseEnter={() => setPreviewIconName(iconName)}
                      onFocus={() => setPreviewIconName(iconName)}
                      aria-label={`选择 ${iconName} 图标`}
                      aria-pressed={selectedIconName === iconName}
                      title={iconName}
                      className={`h-8 rounded-lg flex items-center justify-center transition-all ${selectedIconName === iconName
                        ? 'text-[var(--mint)] bg-[var(--mint-dim)] ring-1 ring-[var(--mint)]'
                        : 'text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(210,210,220,0.1)]'
                        }`}
                    >
                      <DynamicLucideIcon name={iconName} size={15} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-[var(--moon-faint)]">
            没有匹配的图标
          </div>
        )}
      </div>
    </div>
  );
}
