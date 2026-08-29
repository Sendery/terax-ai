import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@/modules/dnd";
import {
  addFlowEdge,
  addFlowNode,
  deleteFlowEdge,
  deleteFlowNode,
  type FlowDirection,
  type FlowEdge,
  type FlowEdgeType,
  type FlowNode,
  type FlowNodeShape,
  updateFlowEdge,
  updateFlowNode,
} from "@/modules/mermaid/lib/flowchartModel";
import type { FlowchartVisualDocument } from "@/modules/mermaid/lib/visualDocument";
import {
  moveFlowLayoutNode,
  normalizeFlowLayout,
  renameFlowLayoutNode,
} from "@/modules/mermaid/lib/visualLayout";
import { useId, useMemo, useState } from "react";
import {
  FLOWCHART_NODE_HEIGHT,
  FLOWCHART_NODE_WIDTH,
  getFlowchartCanvasGeometry,
  getFlowchartEdgeGeometry,
} from "./flowchartVisualGeometry";

const DIRECTIONS: Array<{ value: FlowDirection; label: string }> = [
  { value: "TB", label: "Top to bottom" },
  { value: "TD", label: "Top down" },
  { value: "BT", label: "Bottom to top" },
  { value: "LR", label: "Left to right" },
  { value: "RL", label: "Right to left" },
];

const NODE_SHAPES: Array<{ value: FlowNodeShape; label: string }> = [
  { value: "rectangle", label: "Rectangle" },
  { value: "rounded", label: "Rounded" },
  { value: "stadium", label: "Stadium" },
  { value: "circle", label: "Circle" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "database", label: "Database" },
  { value: "subroutine", label: "Subroutine" },
];

const EDGE_TYPES: Array<{ value: FlowEdgeType; label: string }> = [
  { value: "arrow", label: "Arrow" },
  { value: "open", label: "Open line" },
  { value: "dotted", label: "Dotted arrow" },
  { value: "thick", label: "Thick arrow" },
];

const SELECT_CLASS =
  "h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

const NODE_SHAPE_CLASS: Record<FlowNodeShape, string> = {
  rectangle: "rounded-sm",
  rounded: "rounded-xl",
  stadium: "rounded-full",
  circle: "rounded-[50%]",
  diamond: "[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]",
  hexagon: "[clip-path:polygon(18%_0,82%_0,100%_50%,82%_100%,18%_100%,0_50%)]",
  database: "rounded-[50%/18%] border-x-2",
  subroutine: "rounded-sm border-4 border-double",
};

type Point = { x: number; y: number };
type DragPreview = { nodeId: string; delta: Point };

type MutationResult = {
  model: FlowchartVisualDocument["model"];
  layout?: FlowchartVisualDocument["layout"];
};

function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The diagram could not be updated";
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function DirectionForm({
  direction,
  onSave,
}: {
  direction: FlowDirection;
  onSave: (direction: FlowDirection) => boolean;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(direction);

  return (
    <form
      className="grid grid-cols-[1fr_auto] items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <Field htmlFor={fieldId} label="Diagram direction">
        <select
          id={fieldId}
          className={SELECT_CLASS}
          value={draft}
          onChange={(event) =>
            setDraft(event.currentTarget.value as FlowDirection)
          }
        >
          {DIRECTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" size="sm" disabled={draft === direction}>
        Apply
      </Button>
    </form>
  );
}

function AddNodeForm({
  onAdd,
}: {
  onAdd: (node: {
    id?: string;
    label: string;
    shape: FlowNodeShape;
  }) => boolean;
}) {
  const idId = useId();
  const labelId = useId();
  const shapeId = useId();
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [shape, setShape] = useState<FlowNodeShape>("rectangle");

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const added = onAdd({
          id: id.trim() || undefined,
          label: label.trim(),
          shape,
        });
        if (added) {
          setId("");
          setLabel("");
          setShape("rectangle");
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={idId} label="Node ID (optional)">
          <Input
            id={idId}
            value={id}
            pattern="[A-Za-z][A-Za-z0-9_-]*"
            placeholder="node1"
            title="Start with a letter, then use letters, numbers, underscores, or hyphens"
            onChange={(event) => setId(event.currentTarget.value)}
          />
        </Field>
        <Field htmlFor={shapeId} label="Shape">
          <select
            id={shapeId}
            className={SELECT_CLASS}
            value={shape}
            onChange={(event) =>
              setShape(event.currentTarget.value as FlowNodeShape)
            }
          >
            {NODE_SHAPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field htmlFor={labelId} label="Label">
        <Input
          id={labelId}
          required
          value={label}
          placeholder="New step"
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </Field>
      <Button type="submit" size="sm">
        Add node
      </Button>
    </form>
  );
}

function NodeEditor({
  node,
  position,
  onSave,
  onDelete,
}: {
  node: FlowNode;
  position: Point;
  onSave: (patch: FlowNode & Point) => boolean;
  onDelete: () => void;
}) {
  const idId = useId();
  const labelId = useId();
  const shapeId = useId();
  const xId = useId();
  const yId = useId();
  const [id, setId] = useState(node.id);
  const [label, setLabel] = useState(node.label);
  const [shape, setShape] = useState(node.shape);
  const [x, setX] = useState(String(position.x));
  const [y, setY] = useState(String(position.y));

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          id: id.trim(),
          label: label.trim(),
          shape,
          x: Number(x),
          y: Number(y),
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={idId} label="Node ID">
          <Input
            id={idId}
            required
            value={id}
            pattern="[A-Za-z][A-Za-z0-9_-]*"
            onChange={(event) => setId(event.currentTarget.value)}
          />
        </Field>
        <Field htmlFor={shapeId} label="Shape">
          <select
            id={shapeId}
            className={SELECT_CLASS}
            value={shape}
            onChange={(event) =>
              setShape(event.currentTarget.value as FlowNodeShape)
            }
          >
            {NODE_SHAPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field htmlFor={labelId} label="Label">
        <Input
          id={labelId}
          required
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={xId} label="X position">
          <Input
            id={xId}
            required
            type="number"
            value={x}
            onChange={(event) => setX(event.currentTarget.value)}
          />
        </Field>
        <Field htmlFor={yId} label="Y position">
          <Input
            id={yId}
            required
            type="number"
            value={y}
            onChange={(event) => setY(event.currentTarget.value)}
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" type="submit" size="sm">
          Save node
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </form>
  );
}

function AddEdgeForm({
  nodes,
  onAdd,
}: {
  nodes: FlowNode[];
  onAdd: (edge: Omit<FlowEdge, "id">) => boolean;
}) {
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const typeId = useId();
  const firstNodeId = nodes[0]?.id ?? "";
  const [from, setFrom] = useState(firstNodeId);
  const [to, setTo] = useState(nodes[1]?.id ?? firstNodeId);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FlowEdgeType>("arrow");
  const disabled = nodes.length === 0;

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        const added = onAdd({ from, to, label: label.trim(), type });
        if (added) {
          setLabel("");
          setType("arrow");
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={fromId} label="From">
          <select
            id={fromId}
            className={SELECT_CLASS}
            disabled={disabled}
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} ({node.id})
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={toId} label="To">
          <select
            id={toId}
            className={SELECT_CLASS}
            disabled={disabled}
            value={to}
            onChange={(event) => setTo(event.currentTarget.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} ({node.id})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={labelId} label="Label (optional)">
          <Input
            id={labelId}
            disabled={disabled}
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </Field>
        <Field htmlFor={typeId} label="Line type">
          <select
            id={typeId}
            className={SELECT_CLASS}
            disabled={disabled}
            value={type}
            onChange={(event) =>
              setType(event.currentTarget.value as FlowEdgeType)
            }
          >
            {EDGE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="submit" size="sm" disabled={disabled}>
        Add connection
      </Button>
      {disabled ? (
        <p className="text-xs text-muted-foreground">
          Add a node before creating a connection.
        </p>
      ) : null}
    </form>
  );
}

function EdgeEditor({
  edge,
  nodes,
  onSave,
  onDelete,
}: {
  edge: FlowEdge;
  nodes: FlowNode[];
  onSave: (patch: Omit<FlowEdge, "id">) => boolean;
  onDelete: () => void;
}) {
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const typeId = useId();
  const [from, setFrom] = useState(edge.from);
  const [to, setTo] = useState(edge.to);
  const [label, setLabel] = useState(edge.label);
  const [type, setType] = useState(edge.type);

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ from, to, label: label.trim(), type });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={fromId} label="From">
          <select
            id={fromId}
            className={SELECT_CLASS}
            value={from}
            onChange={(event) => setFrom(event.currentTarget.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} ({node.id})
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor={toId} label="To">
          <select
            id={toId}
            className={SELECT_CLASS}
            value={to}
            onChange={(event) => setTo(event.currentTarget.value)}
          >
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label} ({node.id})
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field htmlFor={labelId} label="Label (optional)">
          <Input
            id={labelId}
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </Field>
        <Field htmlFor={typeId} label="Line type">
          <select
            id={typeId}
            className={SELECT_CLASS}
            value={type}
            onChange={(event) =>
              setType(event.currentTarget.value as FlowEdgeType)
            }
          >
            {EDGE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" type="submit" size="sm">
          Save connection
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={onDelete}
        >
          Delete
        </Button>
      </div>
    </form>
  );
}

type DragListeners = Record<string, unknown> | undefined;

// The Move badge stays the keyboard handle and keeps dnd-kit's full listener
// set. The node body only takes pointer activation: the body is a toggle
// button, so a duplicated onKeyDown would make Space both select the node and
// start a keyboard drag.
export function pointerDragListeners(
  listeners: DragListeners,
): Record<string, unknown> {
  const onPointerDown = listeners?.onPointerDown;
  return onPointerDown ? { onPointerDown } : {};
}

function DraggableNode({
  node,
  position,
  selected,
  onSelect,
}: {
  node: FlowNode;
  position: Point;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: node.id });
  const bodyDragListeners = pointerDragListeners(listeners);
  const transformStyle = transform
    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute z-10 shadow-sm transition-shadow",
        isDragging && "z-30 shadow-xl",
      )}
      style={{
        left: position.x,
        top: position.y,
        width: FLOWCHART_NODE_WIDTH,
        height: FLOWCHART_NODE_HEIGHT,
        transform: transformStyle,
      }}
    >
      <button
        type="button"
        className={cn(
          "flex size-full cursor-grab items-center justify-center border bg-card px-6 text-center text-sm font-medium text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/40 active:cursor-grabbing",
          NODE_SHAPE_CLASS[node.shape],
          selected ? "border-primary ring-2 ring-primary/30" : "border-border",
        )}
        aria-pressed={selected}
        {...bodyDragListeners}
        onClick={onSelect}
      >
        <span className="line-clamp-2 break-words">{node.label}</span>
      </button>
      <button
        type="button"
        className="absolute -top-3 -right-3 z-20 rounded-full border border-border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        {...attributes}
        {...listeners}
        aria-label={`Move ${node.label}. Press Space to pick up, use arrow keys to move, then press Space to drop.`}
        onFocus={onSelect}
      >
        Move
      </button>
    </div>
  );
}

function edgeAppearance(type: FlowEdgeType): {
  markerEnd?: string;
  strokeDasharray?: string;
  strokeWidth: number;
} {
  switch (type) {
    case "open":
      return { strokeWidth: 2 };
    case "dotted":
      return {
        markerEnd: "url(#flowchart-arrow)",
        strokeDasharray: "6 5",
        strokeWidth: 2,
      };
    case "thick":
      return { markerEnd: "url(#flowchart-arrow)", strokeWidth: 4 };
    case "arrow":
      return { markerEnd: "url(#flowchart-arrow)", strokeWidth: 2 };
  }
}

export function FlowchartVisualEditor(props: {
  document: FlowchartVisualDocument;
  onCommit: (document: FlowchartVisualDocument) => void;
}): React.JSX.Element {
  const { document, onCommit } = props;
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    document.model.nodes[0]?.id ?? null,
  );
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const normalizedLayout = normalizeFlowLayout(
    document.model.nodes,
    document.layout,
  );
  const canvas = useMemo(
    () =>
      getFlowchartCanvasGeometry(
        document.model.nodes.map((node) => ({
          id: node.id,
          x: normalizedLayout.positions[node.id]?.x ?? 0,
          y: normalizedLayout.positions[node.id]?.y ?? 0,
        })),
      ),
    [document.model.nodes, normalizedLayout.positions],
  );
  const edgePositions = { ...canvas.positions };
  if (dragPreview) {
    const active = edgePositions[dragPreview.nodeId];
    if (active) {
      edgePositions[dragPreview.nodeId] = {
        x: active.x + dragPreview.delta.x,
        y: active.y + dragPreview.delta.y,
      };
    }
  }
  const selectedNode =
    document.model.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge =
    document.model.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const errorId = useId();
  const markerId = `${useId().replace(/:/g, "")}-flowchart-arrow`;

  const commit = (mutate: () => MutationResult): boolean => {
    try {
      const result = mutate();
      const layout = normalizeFlowLayout(
        result.model.nodes,
        result.layout ?? normalizedLayout,
      );
      onCommit({ kind: "flowchart", model: result.model, layout });
      setError(null);
      return true;
    } catch (nextError) {
      setError(messageFromError(nextError));
      return false;
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragPreview(null);
    commit(() => ({
      model: document.model,
      layout: moveFlowLayoutNode(
        normalizedLayout,
        String(event.active.id),
        event.delta,
      ),
    }));
  };

  return (
    <section
      className="@container/flowchart flex size-full min-h-0 flex-col bg-background text-foreground"
      aria-label="Flowchart visual editor"
      aria-describedby={error ? errorId : undefined}
    >
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-border/60 px-3 py-2">
        <div>
          <h2 className="text-sm font-semibold">Flowchart editor</h2>
          <p className="text-xs text-muted-foreground">
            Drag a node or use its Move button with the keyboard. Exact
            positions can be entered in the node inspector.
          </p>
        </div>
        <DirectionForm
          key={document.model.direction}
          direction={document.model.direction}
          onSave={(direction) =>
            commit(() => ({
              model: { ...document.model, direction },
            }))
          }
        />
      </header>

      {error ? (
        <div
          id={errorId}
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{error}</span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col @5xl/flowchart:flex-row">
        <div className="min-h-64 min-w-0 flex-1 basis-1/2 overflow-auto bg-muted/10 p-3 @5xl/flowchart:min-h-80 @5xl/flowchart:basis-auto">
          <DndContext
            sensors={sensors}
            onDragStart={(event) => {
              const nodeId = String(event.active.id);
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
              setDragPreview({ nodeId, delta: { x: 0, y: 0 } });
            }}
            onDragMove={(event) =>
              setDragPreview({
                nodeId: String(event.active.id),
                delta: event.delta,
              })
            }
            onDragCancel={() => setDragPreview(null)}
            onDragEnd={handleDragEnd}
          >
            <section
              className="relative overflow-hidden rounded-xl border border-border/70 bg-background shadow-inner [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:20px_20px]"
              style={{ width: canvas.width, height: canvas.height }}
              aria-label={`Flowchart canvas with ${document.model.nodes.length} nodes and ${document.model.edges.length} connections`}
            >
              {document.model.nodes.length === 0 ? (
                <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
                  Add a node in the inspector to begin.
                </p>
              ) : null}
              <svg
                className="absolute inset-0 size-full overflow-visible"
                width={canvas.width}
                height={canvas.height}
                aria-label="Flowchart connections"
              >
                <defs>
                  <marker
                    id={markerId}
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                    markerUnits="strokeWidth"
                  >
                    <path
                      d="M 0 0 L 8 4 L 0 8 z"
                      fill="var(--muted-foreground)"
                    />
                  </marker>
                </defs>
                {document.model.edges.map((edge) => {
                  const from = edgePositions[edge.from];
                  const to = edgePositions[edge.to];
                  if (!from || !to) return null;
                  const geometry = getFlowchartEdgeGeometry(from, to);
                  const appearance = edgeAppearance(edge.type);
                  const isSelected = selectedEdge?.id === edge.id;
                  const markerEnd = appearance.markerEnd?.replace(
                    "flowchart-arrow",
                    markerId,
                  );

                  return (
                    <g key={edge.id}>
                      <path
                        d={geometry.path}
                        fill="none"
                        stroke={
                          isSelected
                            ? "var(--primary)"
                            : "var(--muted-foreground)"
                        }
                        strokeWidth={appearance.strokeWidth}
                        strokeDasharray={appearance.strokeDasharray}
                        markerEnd={markerEnd}
                        className="pointer-events-none"
                      />

                      {edge.label ? (
                        <text
                          x={geometry.label.x}
                          y={geometry.label.y}
                          textAnchor="middle"
                          className="pointer-events-none fill-foreground text-[12px] font-medium"
                          stroke="var(--background)"
                          strokeWidth="4"
                          paintOrder="stroke"
                        >
                          {edge.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              {document.model.nodes.map((node) => {
                const position = canvas.positions[node.id];
                if (!position) return null;
                return (
                  <DraggableNode
                    key={node.id}
                    node={node}
                    position={position}
                    selected={selectedNode?.id === node.id}
                    onSelect={() => {
                      setSelectedNodeId(node.id);
                      setSelectedEdgeId(null);
                    }}
                  />
                );
              })}
            </section>
          </DndContext>
        </div>

        <aside
          className="min-h-0 w-full flex-1 basis-1/2 overflow-y-auto border-t border-border/60 bg-card/30 @5xl/flowchart:w-96 @5xl/flowchart:flex-none @5xl/flowchart:basis-auto @5xl/flowchart:border-t-0 @5xl/flowchart:border-l"
          aria-label="Flowchart inspector"
        >
          <div className="grid gap-4 p-3">
            <section className="grid gap-2" aria-labelledby="add-node-heading">
              <h3
                id="add-node-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Add node
              </h3>
              <AddNodeForm
                onAdd={(node) => {
                  let nextId = "";
                  const added = commit(() => {
                    const model = addFlowNode(document.model, node);
                    nextId = model.nodes[model.nodes.length - 1]?.id ?? "";
                    return { model };
                  });
                  if (added && nextId) {
                    setSelectedNodeId(nextId);
                    setSelectedEdgeId(null);
                  }
                  return added;
                }}
              />
            </section>

            <section
              className="grid gap-2 border-t border-border/60 pt-4"
              aria-labelledby="node-heading"
            >
              <h3
                id="node-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Node inspector
              </h3>
              {selectedNode ? (
                <NodeEditor
                  key={`${selectedNode.id}:${selectedNode.label}:${selectedNode.shape}:${normalizedLayout.positions[selectedNode.id]?.x}:${normalizedLayout.positions[selectedNode.id]?.y}`}
                  node={selectedNode}
                  position={
                    normalizedLayout.positions[selectedNode.id] ?? {
                      x: 0,
                      y: 0,
                    }
                  }
                  onSave={(patch) => {
                    if (
                      !Number.isFinite(patch.x) ||
                      !Number.isFinite(patch.y)
                    ) {
                      setError("Node coordinates must be finite numbers");
                      return false;
                    }
                    const saved = commit(() => {
                      const model = updateFlowNode(
                        document.model,
                        selectedNode.id,
                        {
                          id: patch.id,
                          label: patch.label,
                          shape: patch.shape,
                        },
                      );
                      let layout = renameFlowLayoutNode(
                        normalizedLayout,
                        selectedNode.id,
                        patch.id,
                      );
                      const current = layout.positions[patch.id];
                      if (current) {
                        layout = moveFlowLayoutNode(layout, patch.id, {
                          x: patch.x - current.x,
                          y: patch.y - current.y,
                        });
                      }
                      return { model, layout };
                    });
                    if (saved) setSelectedNodeId(patch.id);
                    return saved;
                  }}
                  onDelete={() => {
                    if (
                      !window.confirm(
                        `Delete ${selectedNode.label} and all of its connections?`,
                      )
                    ) {
                      return;
                    }
                    const deleted = commit(() => ({
                      model: deleteFlowNode(document.model, selectedNode.id),
                    }));
                    if (deleted) {
                      setSelectedNodeId(null);
                      setSelectedEdgeId(null);
                    }
                  }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a node on the canvas to edit its label, shape, ID, or
                  exact position.
                </p>
              )}
            </section>

            <section
              className="grid gap-2 border-t border-border/60 pt-4"
              aria-labelledby="add-edge-heading"
            >
              <h3
                id="add-edge-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Add connection
              </h3>
              <AddEdgeForm
                key={document.model.nodes.map((node) => node.id).join(":")}
                nodes={document.model.nodes}
                onAdd={(edge) => {
                  let nextId = "";
                  const added = commit(() => {
                    const model = addFlowEdge(document.model, edge);
                    nextId = model.edges[model.edges.length - 1]?.id ?? "";
                    return { model };
                  });
                  if (added && nextId) {
                    setSelectedEdgeId(nextId);
                    setSelectedNodeId(null);
                  }
                  return added;
                }}
              />
            </section>

            <section
              className="grid gap-2 border-t border-border/60 pt-4"
              aria-labelledby="connections-heading"
            >
              <h3
                id="connections-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Connections
              </h3>
              {document.model.edges.length > 0 ? (
                <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
                  <legend className="sr-only">Select a connection</legend>
                  {document.model.edges.map((edge, index) => (
                    <Button
                      key={edge.id}
                      type="button"
                      size="xs"
                      variant={
                        selectedEdge?.id === edge.id ? "secondary" : "outline"
                      }
                      aria-pressed={selectedEdge?.id === edge.id}
                      aria-label={`Connection ${index + 1}: ${edge.from} to ${edge.to}, ${edge.type}${edge.label ? `, ${edge.label}` : ""}`}
                      onClick={() => {
                        setSelectedEdgeId(edge.id);
                        setSelectedNodeId(null);
                      }}
                    >
                      {edge.from} to {edge.to}
                    </Button>
                  ))}
                </fieldset>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No connections yet.
                </p>
              )}
              {selectedEdge ? (
                <EdgeEditor
                  key={`${selectedEdge.id}:${selectedEdge.from}:${selectedEdge.to}:${selectedEdge.label}:${selectedEdge.type}`}
                  edge={selectedEdge}
                  nodes={document.model.nodes}
                  onSave={(patch) =>
                    commit(() => ({
                      model: updateFlowEdge(
                        document.model,
                        selectedEdge.id,
                        patch,
                      ),
                    }))
                  }
                  onDelete={() => {
                    if (!window.confirm("Delete this connection?")) return;
                    const deleted = commit(() => ({
                      model: deleteFlowEdge(document.model, selectedEdge.id),
                    }));
                    if (deleted) setSelectedEdgeId(null);
                  }}
                />
              ) : null}
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
}
