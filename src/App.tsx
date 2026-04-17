import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import "./index.css";

type NodeKey = "center" | "app" | "sites";
type Point = { x: number; y: number };
type NodeHalfSize = { halfWidth: number; halfHeight: number };

type NodeMap = Record<NodeKey, Point>;

const GRAPH_SIZE = { width: 860, height: 520 };
const defaultPositions: NodeMap = {
  center: { x: GRAPH_SIZE.width / 2, y: GRAPH_SIZE.height / 2 },
  app: { x: GRAPH_SIZE.width / 2 - 230, y: GRAPH_SIZE.height / 2 - 120 },
  sites: { x: GRAPH_SIZE.width / 2 + 230, y: GRAPH_SIZE.height / 2 + 120 },
};

const labels: Record<NodeKey, string> = {
  center: "plotline.nz",
  app: "app.plotline.nz",
  sites: "sites.plotline.nz",
};
const nodeKeys = Object.keys(labels) as NodeKey[];

const DEFAULT_NODE_HALF_SIZES: Record<NodeKey, NodeHalfSize> = {
  center: { halfWidth: 106, halfHeight: 26 },
  app: { halfWidth: 96, halfHeight: 24 },
  sites: { halfWidth: 96, halfHeight: 24 },
};

const WOBBLE_SCALE_FACTOR = 0.08;
const MAX_WOBBLE_MAGNITUDE = 2.8;
const DEFAULT_RETURN_FORCE = 0.06;
const PERPENDICULAR_WOBBLE_FACTOR = 0.07;
const VERTICAL_WOBBLE_DAMPING = 0.8;
const COUPLED_PULL_FROM_CENTER_DRAG = 0.44;
const COUPLED_PULL_TO_CENTER = 0.3;
const COUPLED_PULL_TO_PEER = 0.2;
const wobbleDirectionByNode: Record<NodeKey, number> = {
  center: 0,
  app: -1,
  sites: 1,
};

const getCoupledPullForce = (draggedKey: NodeKey, targetKey: NodeKey) => {
  if (draggedKey === "center") return COUPLED_PULL_FROM_CENTER_DRAG;
  if (targetKey === "center") return COUPLED_PULL_TO_CENTER;
  return COUPLED_PULL_TO_PEER;
};
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Partial<Record<NodeKey, HTMLButtonElement | null>>>({});
  const [positions, setPositions] = useState<NodeMap>(defaultPositions);
  const [nodeHalfSizes, setNodeHalfSizes] = useState<Record<NodeKey, NodeHalfSize>>(DEFAULT_NODE_HALF_SIZES);
  const [drag, setDrag] = useState<{
    key: NodeKey;
    offsetX: number;
    offsetY: number;
    halfWidth: number;
    halfHeight: number;
  } | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const clampPointToGraph = (key: NodeKey, point: Point): Point => {
    const bounds = nodeHalfSizes[key];
    return {
      x: clamp(point.x, bounds.halfWidth, GRAPH_SIZE.width - bounds.halfWidth),
      y: clamp(point.y, bounds.halfHeight, GRAPH_SIZE.height - bounds.halfHeight),
    };
  };

  useEffect(() => {
    const measureNodeHalfSizes = () => {
      const graphBounds = graphRef.current?.getBoundingClientRect();
      if (!graphBounds) return;

      const unitsPerPixelX = GRAPH_SIZE.width / graphBounds.width;
      const unitsPerPixelY = GRAPH_SIZE.height / graphBounds.height;

      setNodeHalfSizes(previous => {
        let changed = false;
        const next = { ...previous };

        nodeKeys.forEach(key => {
          const nodeElement = nodeRefs.current[key];
          if (!nodeElement) return;

          const nodeBounds = nodeElement.getBoundingClientRect();
          const halfWidth = (nodeBounds.width / 2) * unitsPerPixelX;
          const halfHeight = (nodeBounds.height / 2) * unitsPerPixelY;

          if (
            Math.abs(previous[key].halfWidth - halfWidth) > 0.01
            || Math.abs(previous[key].halfHeight - halfHeight) > 0.01
          ) {
            next[key] = { halfWidth, halfHeight };
            changed = true;
          }
        });

        return changed ? next : previous;
      });
    };

    measureNodeHalfSizes();

    const resizeObserver = new ResizeObserver(measureNodeHalfSizes);
    if (graphRef.current) {
      resizeObserver.observe(graphRef.current);
    }
    nodeKeys.forEach(key => {
      const nodeElement = nodeRefs.current[key];
      if (nodeElement) {
        resizeObserver.observe(nodeElement);
      }
    });
    window.addEventListener("resize", measureNodeHalfSizes);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureNodeHalfSizes);
    };
  }, []);

  useEffect(() => {
    setPositions(previous => {
      let changed = false;
      const next = { ...previous };

      nodeKeys.forEach(key => {
        const clamped = clampPointToGraph(key, previous[key]);
        if (clamped.x !== previous[key].x || clamped.y !== previous[key].y) {
          next[key] = clamped;
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [nodeHalfSizes]);

  useEffect(() => {
    if (!drag) return;

    const onPointerMove = (event: PointerEvent) => {
      const graphBounds = graphRef.current?.getBoundingClientRect();
      if (!graphBounds) return;
      const unitsPerPixelX = GRAPH_SIZE.width / graphBounds.width;
      const unitsPerPixelY = GRAPH_SIZE.height / graphBounds.height;
      const pointerX = (event.clientX - graphBounds.left) * unitsPerPixelX;
      const pointerY = (event.clientY - graphBounds.top) * unitsPerPixelY;

      const nextX = Math.min(
        Math.max(pointerX - drag.offsetX, drag.halfWidth),
        GRAPH_SIZE.width - drag.halfWidth,
      );
      const nextY = Math.min(
        Math.max(pointerY - drag.offsetY, drag.halfHeight),
        GRAPH_SIZE.height - drag.halfHeight,
      );

      setPositions(previous => {
        const movedBy = {
          x: nextX - previous[drag.key].x,
          y: nextY - previous[drag.key].y,
        };
        const movedMagnitude = Math.hypot(movedBy.x, movedBy.y);

        const nextPositions = { ...previous };
        nextPositions[drag.key] = { x: nextX, y: nextY };

        nodeKeys.forEach(key => {
          if (key === drag.key) return;

          const coupledPull = getCoupledPullForce(drag.key, key);
          const toDefault = {
            x: defaultPositions[key].x - previous[key].x,
            y: defaultPositions[key].y - previous[key].y,
          };
          const wobbleStrength = Math.min(movedMagnitude * WOBBLE_SCALE_FACTOR, MAX_WOBBLE_MAGNITUDE);
          const wobbleDirection = wobbleDirectionByNode[key];
          const coupledMotion = {
            x: movedBy.x * coupledPull,
            y: movedBy.y * coupledPull,
          };
          const restoreForce = {
            x: toDefault.x * DEFAULT_RETURN_FORCE,
            y: toDefault.y * DEFAULT_RETURN_FORCE,
          };
          const perpendicularWobble = {
            x: movedBy.y * PERPENDICULAR_WOBBLE_FACTOR * wobbleDirection,
            y: -movedBy.x * PERPENDICULAR_WOBBLE_FACTOR * wobbleDirection,
          };
          const impulseWobble = {
            x: wobbleStrength * wobbleDirection,
            y: -wobbleStrength * wobbleDirection * VERTICAL_WOBBLE_DAMPING,
          };

          const nextPoint = {
            x: previous[key].x + coupledMotion.x + restoreForce.x + perpendicularWobble.x + impulseWobble.x,
            y: previous[key].y + coupledMotion.y + restoreForce.y + perpendicularWobble.y + impulseWobble.y,
          };

          nextPositions[key] = clampPointToGraph(key, nextPoint);
        });

        return nextPositions;
      });
    };

    const onPointerUp = () => setDrag(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag]);

  const handleSceneMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const sceneBounds = sceneRef.current?.getBoundingClientRect();
    if (!sceneBounds) return;

    const offsetX = (event.clientX - sceneBounds.left) / sceneBounds.width - 0.5;
    const offsetY = (event.clientY - sceneBounds.top) / sceneBounds.height - 0.5;

    setParallax({
      x: Math.round(offsetX * 2000) / 1000,
      y: Math.round(offsetY * 2000) / 1000,
    });
  };

  const edges = useMemo(
    () => [
      { from: positions.center, to: positions.app },
      { from: positions.center, to: positions.sites },
    ],
    [positions],
  );

  return (
    <div
      ref={sceneRef}
      className="space-page"
      onPointerMove={handleSceneMove}
      style={
        {
          "--parallax-x": `${parallax.x}`,
          "--parallax-y": `${parallax.y}`,
        } as CSSProperties
      }
    >
      <div className="graph" ref={graphRef}>
        <svg className="edges" viewBox={`0 0 ${GRAPH_SIZE.width} ${GRAPH_SIZE.height}`} aria-hidden="true">
          {edges.map((edge, index) => (
            <line key={index} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y} />
          ))}
        </svg>

        {nodeKeys.map(key => (
          <button
            key={key}
            type="button"
            className={`node ${key === "center" ? "center" : "leaf"}`}
            ref={element => {
              nodeRefs.current[key] = element;
            }}
            style={{
              left: `${(positions[key].x / GRAPH_SIZE.width) * 100}%`,
              top: `${(positions[key].y / GRAPH_SIZE.height) * 100}%`,
            }}
            onPointerDown={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const graphBounds = graphRef.current?.getBoundingClientRect();
              if (!graphBounds) return;
              const unitsPerPixelX = GRAPH_SIZE.width / graphBounds.width;
              const unitsPerPixelY = GRAPH_SIZE.height / graphBounds.height;
              const centerX = (bounds.left + bounds.width / 2 - graphBounds.left) * unitsPerPixelX;
              const centerY = (bounds.top + bounds.height / 2 - graphBounds.top) * unitsPerPixelY;
              const pointerX = (event.clientX - graphBounds.left) * unitsPerPixelX;
              const pointerY = (event.clientY - graphBounds.top) * unitsPerPixelY;
              setDrag({
                key,
                offsetX: pointerX - centerX,
                offsetY: pointerY - centerY,
                halfWidth: (bounds.width / 2) * unitsPerPixelX,
                halfHeight: (bounds.height / 2) * unitsPerPixelY,
              });
            }}
          >
            {labels[key]}
          </button>
        ))}
      </div>
    </div>
  );
}
