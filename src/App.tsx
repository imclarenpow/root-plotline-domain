import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import "./index.css";

type NodeKey = "center" | "app" | "sites";
type Point = { x: number; y: number };
type NodeHalfSize = { halfWidth: number; halfHeight: number };

type NodeMap = Record<NodeKey, Point>;
type VelocityMap = Record<NodeKey, Point>;

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

const RESTORE_FORCE = 0.025;
const DAMPING_PER_FRAME = 0.9;
const RANDOM_JIGGLE_FORCE = 0.22;
const DRAG_COUPLING_FORCE = 0.18;
const MAX_VELOCITY = 11;
const COLLISION_PADDING = 10;
const COLLISION_RESPONSE = 0.3;
const TARGET_FRAME_TIME_MS = 16.67;
const MAX_DELTA_MULTIPLIER = 2;
const COLLISION_RESOLUTION_PASSES = 2;
const SIZE_CHANGE_THRESHOLD = 0.01;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const createZeroVelocities = (): VelocityMap => ({
  center: { x: 0, y: 0 },
  app: { x: 0, y: 0 },
  sites: { x: 0, y: 0 },
});
const limitVelocity = (point: Point): Point => {
  const magnitude = Math.hypot(point.x, point.y);
  if (magnitude <= MAX_VELOCITY) return point;
  const scale = MAX_VELOCITY / magnitude;
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
};

export function App() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Partial<Record<NodeKey, HTMLButtonElement | null>>>({});
  const velocitiesRef = useRef<VelocityMap>(createZeroVelocities());
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
  const clampPointToGraph = useCallback((key: NodeKey, point: Point): Point => {
    const bounds = nodeHalfSizes[key];
    return {
      x: clamp(point.x, bounds.halfWidth, GRAPH_SIZE.width - bounds.halfWidth),
      y: clamp(point.y, bounds.halfHeight, GRAPH_SIZE.height - bounds.halfHeight),
    };
  }, [nodeHalfSizes]);

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
            Math.abs(previous[key].halfWidth - halfWidth) > SIZE_CHANGE_THRESHOLD
            || Math.abs(previous[key].halfHeight - halfHeight) > SIZE_CHANGE_THRESHOLD
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
    return () => {
      resizeObserver.disconnect();
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
  }, [clampPointToGraph]);

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
        const nextPositions = { ...previous };
        nextPositions[drag.key] = { x: nextX, y: nextY };
        velocitiesRef.current[drag.key] = { x: 0, y: 0 };

        nodeKeys.forEach(key => {
          if (key === drag.key) return;
          const nextVelocity = limitVelocity({
            x: velocitiesRef.current[key].x + movedBy.x * DRAG_COUPLING_FORCE,
            y: velocitiesRef.current[key].y + movedBy.y * DRAG_COUPLING_FORCE,
          });
          velocitiesRef.current[key] = nextVelocity;
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

  useEffect(() => {
    let frame = 0;
    let lastTimestamp = performance.now();

    const step = (timestamp: number) => {
      const deltaMultiplier = Math.min((timestamp - lastTimestamp) / TARGET_FRAME_TIME_MS, MAX_DELTA_MULTIPLIER);
      lastTimestamp = timestamp;

      setPositions(previous => {
        const next = { ...previous };
        const activeDragKey = drag?.key;

        nodeKeys.forEach(key => {
          if (key === activeDragKey) return;

          const velocity = velocitiesRef.current[key];
          const jiggle = {
            x: (Math.random() - 0.5) * RANDOM_JIGGLE_FORCE,
            y: (Math.random() - 0.5) * RANDOM_JIGGLE_FORCE,
          };
          const toDefault = {
            x: defaultPositions[key].x - previous[key].x,
            y: defaultPositions[key].y - previous[key].y,
          };
          const damping = Math.pow(DAMPING_PER_FRAME, deltaMultiplier);
          const accelerated = limitVelocity({
            x: (velocity.x + (toDefault.x * RESTORE_FORCE + jiggle.x) * deltaMultiplier) * damping,
            y: (velocity.y + (toDefault.y * RESTORE_FORCE + jiggle.y) * deltaMultiplier) * damping,
          });
          velocitiesRef.current[key] = accelerated;
          next[key] = clampPointToGraph(key, {
            x: previous[key].x + accelerated.x * deltaMultiplier,
            y: previous[key].y + accelerated.y * deltaMultiplier,
          });
        });

        for (let pass = 0; pass < COLLISION_RESOLUTION_PASSES; pass += 1) {
          for (let index = 0; index < nodeKeys.length; index += 1) {
            for (let compareIndex = index + 1; compareIndex < nodeKeys.length; compareIndex += 1) {
              const aKey = nodeKeys[index];
              const bKey = nodeKeys[compareIndex];
              const a = next[aKey];
              const b = next[bKey];
              const overlapX = (nodeHalfSizes[aKey].halfWidth + nodeHalfSizes[bKey].halfWidth + COLLISION_PADDING) - Math.abs(a.x - b.x);
              const overlapY = (nodeHalfSizes[aKey].halfHeight + nodeHalfSizes[bKey].halfHeight + COLLISION_PADDING) - Math.abs(a.y - b.y);

              if (overlapX <= 0 || overlapY <= 0) continue;

              const moveA = aKey !== activeDragKey;
              const moveB = bKey !== activeDragKey;
              if (!moveA && !moveB) continue;

              if (overlapX < overlapY) {
                const direction = b.x >= a.x ? 1 : -1;
                const distance = moveA && moveB ? overlapX / 2 : overlapX;

                if (moveA) {
                  next[aKey] = clampPointToGraph(aKey, { x: next[aKey].x - direction * distance, y: next[aKey].y });
                  velocitiesRef.current[aKey] = limitVelocity({
                    x: velocitiesRef.current[aKey].x - direction * distance * COLLISION_RESPONSE,
                    y: velocitiesRef.current[aKey].y,
                  });
                }

                if (moveB) {
                  next[bKey] = clampPointToGraph(bKey, { x: next[bKey].x + direction * distance, y: next[bKey].y });
                  velocitiesRef.current[bKey] = limitVelocity({
                    x: velocitiesRef.current[bKey].x + direction * distance * COLLISION_RESPONSE,
                    y: velocitiesRef.current[bKey].y,
                  });
                }
              } else {
                const direction = b.y >= a.y ? 1 : -1;
                const distance = moveA && moveB ? overlapY / 2 : overlapY;

                if (moveA) {
                  next[aKey] = clampPointToGraph(aKey, { x: next[aKey].x, y: next[aKey].y - direction * distance });
                  velocitiesRef.current[aKey] = limitVelocity({
                    x: velocitiesRef.current[aKey].x,
                    y: velocitiesRef.current[aKey].y - direction * distance * COLLISION_RESPONSE,
                  });
                }

                if (moveB) {
                  next[bKey] = clampPointToGraph(bKey, { x: next[bKey].x, y: next[bKey].y + direction * distance });
                  velocitiesRef.current[bKey] = limitVelocity({
                    x: velocitiesRef.current[bKey].x,
                    y: velocitiesRef.current[bKey].y + direction * distance * COLLISION_RESPONSE,
                  });
                }
              }
            }
          }
        }

        return next;
      });

      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [clampPointToGraph, drag, nodeHalfSizes]);

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
