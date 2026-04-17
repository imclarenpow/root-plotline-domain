import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import "./index.css";

type NodeKey = "center" | "app" | "sites";
type Point = { x: number; y: number };

type NodeMap = Record<NodeKey, Point>;
const nodeKeys: NodeKey[] = ["center", "app", "sites"];

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

const nodeBounds: Record<NodeKey, { halfWidth: number; halfHeight: number }> = {
  center: { halfWidth: 106, halfHeight: 26 },
  app: { halfWidth: 96, halfHeight: 24 },
  sites: { halfWidth: 96, halfHeight: 24 },
};

const WOBBLE_SCALE_FACTOR = 0.08;
const MAX_WOBBLE_MAGNITUDE = 2.8;
const DEFAULT_RETURN_FORCE = 0.06;
const PERPENDICULAR_WOBBLE_FACTOR = 0.07;
const VERTICAL_WOBBLE_DAMPING = 0.8;

const clampPointToGraph = (key: NodeKey, point: Point): Point => {
  const bounds = nodeBounds[key];
  return {
    x: Math.min(Math.max(point.x, bounds.halfWidth), GRAPH_SIZE.width - bounds.halfWidth),
    y: Math.min(Math.max(point.y, bounds.halfHeight), GRAPH_SIZE.height - bounds.halfHeight),
  };
};

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<NodeMap>(defaultPositions);
  const [drag, setDrag] = useState<{
    key: NodeKey;
    offsetX: number;
    offsetY: number;
    halfWidth: number;
    halfHeight: number;
  } | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

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

          const coupledPull =
            drag.key === "center" ? 0.44 : key === "center" ? 0.3 : 0.2;
          const toDefault = {
            x: defaultPositions[key].x - previous[key].x,
            y: defaultPositions[key].y - previous[key].y,
          };
          const wobbleStrength = Math.min(movedMagnitude * WOBBLE_SCALE_FACTOR, MAX_WOBBLE_MAGNITUDE);
          const wobbleDirection = key === "sites" ? 1 : -1;

          const shifted = {
            x: previous[key].x + movedBy.x * coupledPull + toDefault.x * DEFAULT_RETURN_FORCE + movedBy.y * PERPENDICULAR_WOBBLE_FACTOR * wobbleDirection,
            y: previous[key].y + movedBy.y * coupledPull + toDefault.y * DEFAULT_RETURN_FORCE - movedBy.x * PERPENDICULAR_WOBBLE_FACTOR * wobbleDirection,
          };

          const withWobble = {
            x: shifted.x + wobbleStrength * wobbleDirection,
            y: shifted.y - wobbleStrength * wobbleDirection * VERTICAL_WOBBLE_DAMPING,
          };

          nextPositions[key] = clampPointToGraph(key, withWobble);
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
