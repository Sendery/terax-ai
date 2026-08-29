// Drag-and-drop foundation. Pointer-based (dnd-kit), so it is independent of
// Tauri's native OS drag-drop channel (dragDropEnabled) used for terminal file
// drops. HTML5-DnD libs cannot be used here: the native channel swallows them.
// Single import surface so surfaces never reach into dnd-kit directly.

export {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
export {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
export { CSS } from "@dnd-kit/utilities";
export { DropIndicator, type Edge } from "./DropIndicator";
