import { useSortable } from '@dnd-kit/react/sortable';

type SortHandleRef = (element: Element | null) => void;

export function SortableRow({
  id,
  index,
  group,
  className = '',
  children,
}: {
  id: string | number;
  index: number;
  group?: string;
  className?: string;
  children: (handleRef: SortHandleRef, isDragging: boolean) => React.ReactNode;
}) {
  const sortable = useSortable({
    id,
    index,
    ...(group ? { group, type: group, accept: group } : {}),
    transition: { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', idle: true },
  });

  return (
    <div ref={sortable.ref} className={`${className} ${sortable.isDragging ? 'z-10 opacity-80 drop-shadow-lg' : ''}`}>
      {children(sortable.handleRef, sortable.isDragging)}
    </div>
  );
}
