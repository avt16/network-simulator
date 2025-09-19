import React, { useRef, useState, useEffect, useCallback } from "react";

// NetworkSimulator.jsx
// Single-file React component that provides:
// - configurable grid (rows x cols)
// - draw mode: wall (map boundaries), erase, place POI (with size), place START
// - simulate button: runs multiple stochastic trials (optional) showing them in low opacity
//   then shows the final "optimal" route (computed deterministically) at full opacity.
// Implementation notes:
// - Pathfinding uses A* on 4-connected grid, respects walls
// - For multiple POIs we compute shortest-path distances between all terminals (start + POIs)
//   then form a Minimum Spanning Tree (MST) on that complete graph (Prim's), and stitch
//   the full grid-level network by union of the A* paths corresponding to MST edges.
// - Multiple trials: add tiny random noise to move costs when computing A*, to produce
//   alternative plausible networks. Trials are drawn in low opacity first, then the
//   final deterministic solution is displayed.

export default function NetworkSimulator() {
  // default grid size
  const [rows, setRows] = useState(40);
  const [cols, setCols] = useState(60);

  // grid representation: 0 = empty, 1 = wall, 2 = start, 3 = poi (with metadata in POIs map)
  const [grid, setGrid] = useState(() => createEmptyGrid(40, 60));
  const [poiMap, setPoiMap] = useState({}); // key = r_c -> {r,c,size,color}
  const [start, setStart] = useState(null); // {r,c}

  // drawing
  const [mode, setMode] = useState("wall"); // wall, erase, poi, start
  const [poiSize, setPoiSize] = useState(3);
  const [selectedPoiColor, setSelectedPoiColor] = useState("#ff7f50");

  // simulation options
  const [trials, setTrials] = useState(20);
  const [showTrials, setShowTrials] = useState(true);
  const [trialOpacity, setTrialOpacity] = useState(0.12);
  const [animateGrowth, setAnimateGrowth] = useState(true);

  const canvasRef = useRef(null);
  const cellSize = 16; // px

  // visual state
  const [solutionPaths, setSolutionPaths] = useState([]); // final path cells set
  const [trialPaths, setTrialPaths] = useState([]); // array of path sets
  const [isSimulating, setIsSimulating] = useState(false);
  const [isMouseDown, setIsMouseDown] = useState(false);

  useEffect(() => {
    setGrid(createEmptyGrid(rows, cols));
    setPoiMap({});
    setStart(null);
    setSolutionPaths([]);
    setTrialPaths([]);
  }, [rows, cols]);

  

  function createGridCopy(g) {
    return g.map((row) => row.slice());
  }

  function handleCanvasClick(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cellSize);
    const r = Math.floor(y / cellSize);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;

    if (mode === "wall") {
      const g = createGridCopy(grid);
      g[r][c] = g[r][c] === 1 ? 0 : 1;
      setGrid(g);
    } else if (mode === "erase") {
      const g = createGridCopy(grid);
      if (g[r][c] === 3) {
        const key = `${r}_${c}`;
        const pm = { ...poiMap };
        delete pm[key];
        setPoiMap(pm);
      }
      if (g[r][c] === 2) setStart(null);
      g[r][c] = 0;
      setGrid(g);
    } else if (mode === "poi") {
      const g = createGridCopy(grid);
      g[r][c] = 3;
      const key = `${r}_${c}`;
      setPoiMap({ ...poiMap, [key]: { r, c, size: poiSize, color: selectedPoiColor } });
      setGrid(g);
    } else if (mode === "start") {
      const g = createGridCopy(grid);
      // remove old start
      if (start) {
        g[start.r][start.c] = 0;
      }
      g[r][c] = 2;
      setStart({ r, c });
      setGrid(g);
    }
  }

  function handlePointerDown(e) {
    setIsMouseDown(true);
    if (mode === 'poi' || mode === 'start') {
      handleCanvasClick(e);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cellSize);
    const r = Math.floor(y / cellSize);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (mode === 'wall') {
      const g = createGridCopy(grid);
      if (g[r][c] !== 1) { g[r][c] = 1; setGrid(g); }
    } else if (mode === 'erase') {
      const g = createGridCopy(grid);
      if (g[r][c] === 3) {
        const key = `${r}_${c}`;
        const pm = { ...poiMap };
        delete pm[key];
        setPoiMap(pm);
      }
      if (g[r][c] === 2) setStart(null);
      if (g[r][c] !== 0) { g[r][c] = 0; setGrid(g); }
    }
  }

  function handlePointerMove(e) {
    if (!isMouseDown) return;
    if (mode !== 'wall' && mode !== 'erase') return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / cellSize);
    const r = Math.floor(y / cellSize);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (mode === 'wall') {
      if (grid[r][c] === 1) return;
      const g = createGridCopy(grid);
      g[r][c] = 1;
      setGrid(g);
    } else if (mode === 'erase') {
      if (grid[r][c] === 0 && grid[r][c] !== 2 && grid[r][c] !== 3) return;
      const g = createGridCopy(grid);
      if (g[r][c] === 3) {
        const key = `${r}_${c}`;
        const pm = { ...poiMap };
        delete pm[key];
        setPoiMap(pm);
      }
      if (g[r][c] === 2) setStart(null);
      g[r][c] = 0;
      setGrid(g);
    }
  }

  function handlePointerUp() {
    setIsMouseDown(false);
  }

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    const ctx = canvas.getContext("2d");

    // If grid hasn't been resized to match rows/cols yet, skip this frame
    if (!Array.isArray(grid) || grid.length === 0) return;
    const gridRows = grid.length;
    const gridCols = Array.isArray(grid[0]) ? grid[0].length : 0;
    if (gridRows !== rows || gridCols !== cols) return;

    // background
    ctx.fillStyle = "#f8fafc"; // light
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // grid cells
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        const x = c * cellSize;
        const y = r * cellSize;
        if (val === 1) {
          ctx.fillStyle = "#111827"; // wall dark
          ctx.fillRect(x, y, cellSize, cellSize);
        } else {
          // draw subtle cell background
          ctx.fillStyle = (r + c) % 2 === 0 ? "#ffffff" : "#fbfdff";
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }

    // draw POIs (with radius showing 'size')
    Object.values(poiMap).forEach((p) => {
      const cx = p.c * cellSize + cellSize / 2;
      const cy = p.r * cellSize + cellSize / 2;
      const radius = Math.max(4, p.size * 3);
      // glow
      ctx.beginPath();
      ctx.fillStyle = hexToRgba(p.color, 0.14);
      ctx.arc(cx, cy, radius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // main circle
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // label size
      ctx.fillStyle = "#000000";
      ctx.font = "10px sans-serif";
      ctx.fillText(p.size, cx - 3, cy + 3);
    });

    // draw start
    if (start) {
      const cx = start.c * cellSize + cellSize / 2;
      const cy = start.r * cellSize + cellSize / 2;
      ctx.beginPath();
      ctx.fillStyle = "#2dd4bf"; // teal
      ctx.arc(cx, cy, cellSize * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.font = "10px sans-serif";
      ctx.fillText("S", cx - 4, cy + 4);
    }

    // draw trials with low opacity
    trialPaths.forEach((pathObj) => {
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, cellSize * 0.5);
      ctx.lineCap = "round";
      ctx.strokeStyle = hexToRgba("#6366f1", trialOpacity); // indigo trials
      pathObj.cells.forEach((cell, idx) => {
        const x = cell.c * cellSize + cellSize / 2;
        const y = cell.r * cellSize + cellSize / 2;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    // draw final solution
    if (solutionPaths.length > 0) {
      ctx.beginPath();
      ctx.lineWidth = Math.max(2, cellSize * 0.7);
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ef4444"; // red
      // solutionPaths is a list of continuous paths
      solutionPaths.forEach((p) => {
        p.forEach((cell, idx) => {
          const x = cell.c * cellSize + cellSize / 2;
          const y = cell.r * cellSize + cellSize / 2;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      });
      ctx.stroke();

      // overlay nodes where network meets POI and start
      if (start) {
        const cx = start.c * cellSize + cellSize / 2;
        const cy = start.r * cellSize + cellSize / 2;
        ctx.beginPath();
        ctx.fillStyle = "#111827";
        ctx.arc(cx, cy, cellSize * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      Object.values(poiMap).forEach((p) => {
        const cx = p.c * cellSize + cellSize / 2;
        const cy = p.r * cellSize + cellSize / 2;
        ctx.beginPath();
        ctx.fillStyle = "#000";
        ctx.arc(cx, cy, cellSize * 0.18, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // grid lines
    ctx.strokeStyle = "#e6edf3";
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cellSize + 0.5);
      ctx.lineTo(cols * cellSize, r * cellSize + 0.5);
      ctx.stroke();
    }
    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cellSize + 0.5, 0);
      ctx.lineTo(c * cellSize + 0.5, rows * cellSize);
      ctx.stroke();
    }
  }, [cols, rows, grid, poiMap, start, trialPaths, solutionPaths, trialOpacity, cellSize]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // --- Simulation core ---
  async function runSimulation() {
    // quick sanity checks
    if (!start) {
      alert("Place a start point first.");
      return;
    }
    if (Object.keys(poiMap).length === 0) {
      alert("Place at least one point of interest (POI).\nThe network needs somewhere to connect to.");
      return;
    }

    setIsSimulating(true);
    setTrialPaths([]);
    setSolutionPaths([]);

    // terminals array
    const terminals = [start, ...Object.values(poiMap).map((p) => ({ r: p.r, c: p.c }))];

    // Function to compute A* with optional noise multiplier
    function computeAstarPath(s, t, noiseSeed = 0) {
      const keyFor = (r, c) => `${r}_${c}`;
      const open = new MinHeap((a, b) => a.f - b.f);
      const startNode = { r: s.r, c: s.c, g: 0, f: 0, prev: null };
      startNode.f = heuristic(s, t);
      open.push(startNode);
      const closed = new Map();

      while (!open.isEmpty()) {
        const cur = open.pop();
        const curKey = keyFor(cur.r, cur.c);
        if (closed.has(curKey)) continue;
        closed.set(curKey, cur);
        if (cur.r === t.r && cur.c === t.c) {
          // reconstruct path
          const path = [];
          let p = cur;
          while (p) {
            path.push({ r: p.r, c: p.c });
            p = p.prev;
          }
          return path.reverse();
        }
        const neighs = neighbors(cur.r, cur.c, rows, cols);
        for (const n of neighs) {
          if (grid[n.r][n.c] === 1) continue; // wall
          const nKey = keyFor(n.r, n.c);
          if (closed.has(nKey)) continue;
          // base cost 1; add extra cost inversely proportional to POI attraction
          let moveCost = 1;
          // cells near big POIs are slightly cheaper to encourage passing near them
          Object.values(poiMap).forEach((poi) => {
            const dist = Math.abs(poi.r - n.r) + Math.abs(poi.c - n.c);
            // influence radius approx = poi.size * 3
            const radius = Math.max(1, Math.floor(poi.size * 3));
            if (dist <= radius) {
              moveCost *= 0.9 - Math.min(0.35, poi.size * 0.02);
            }
          });

          // noise to produce different trials
          if (noiseSeed !== 0) {
            // deterministic-ish noise from seed and coords
            const noise = pseudoRandomHash(n.r, n.c, noiseSeed) * 0.7;
            moveCost *= 1 + noise;
          }

          const gscore = cur.g + moveCost;
          const fscore = gscore + heuristic(n, t);
          open.push({ r: n.r, c: n.c, g: gscore, f: fscore, prev: cur });
        }
      }
      // no path
      return null;
    }

    // runs one trial and returns union of MST paths cells
    function runOneTrial(seed = 0) {
      // 1) compute pairwise shortest paths between terminals
      const n = terminals.length;
      const pairPaths = {}; // key i_j -> path
      const distMat = Array.from({ length: n }, () => Array(n).fill(Infinity));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const s = terminals[i];
          const t = terminals[j];
          const path = computeAstarPath(s, t, seed);
          if (!path) {
            distMat[i][j] = distMat[j][i] = Infinity;
          } else {
            distMat[i][j] = distMat[j][i] = path.length;
            pairPaths[`${i}_${j}`] = path;
          }
        }
      }

      // 2) Build MST over terminals using Prim's algorithm on distMat
      const inMST = new Array(n).fill(false);
      const edges = [];
      const minEdge = new Array(n).fill(Infinity);
      const selEdge = new Array(n).fill(-1);
      minEdge[0] = 0;
      for (let k = 0; k < n; k++) {
        let v = -1;
        for (let i = 0; i < n; i++) if (!inMST[i] && (v === -1 || minEdge[i] < minEdge[v])) v = i;
        if (minEdge[v] === Infinity) break; // disconnected
        inMST[v] = true;
        if (selEdge[v] !== -1) {
          edges.push([v, selEdge[v]]);
        }
        for (let to = 0; to < n; to++) {
          if (distMat[v][to] < minEdge[to]) {
            minEdge[to] = distMat[v][to];
            selEdge[to] = v;
          }
        }
      }

      // 3) stitch the union of paths
      const unionCells = new Set();
      const unionPathArrays = [];
      edges.forEach(([a, b]) => {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        const path = pairPaths[key];
        if (path) {
          path.forEach((cell) => unionCells.add(`${cell.r}_${cell.c}`));
          unionPathArrays.push(path);
        }
      });

      return { cells: Array.from(unionCells).map((k) => { const [r,c]=k.split('_').map(Number); return {r,c};}), arrays: unionPathArrays };
    }

    // run trials
    const allTrials = [];
    if (showTrials) {
      for (let tIdx = 0; tIdx < trials; tIdx++) {
        const seed = tIdx + 1;
        const trial = runOneTrial(seed);
        allTrials.push(trial);
        setTrialPaths((prev) => [...prev, trial]);
        // small delay for UI to draw them progressively (not too long)
        await sleep(20);
      }
    }

    // compute final deterministic solution (seed 0)
    const final = runOneTrial(0);
    setSolutionPaths(final.arrays);

    // optionally animate growth by drawing incremental segments
    if (animateGrowth) {
      // we already painted everything, but if user wants growth animation we can animate the final path stroke
      // For simplicity, we'll briefly re-draw final paths stroke segments with a short pause to give growth feeling
      await animatePathDrawing(final.arrays);
    }

    setIsSimulating(false);
  }

  // animate drawing final paths by progressively setting solutionPaths
  async function animatePathDrawing(arrays) {
    setSolutionPaths([]);
    for (let i = 0; i < arrays.length; i++) {
      const seg = arrays[i];
      const chunks = chunkArray(seg, 6);
      let built = [];
      for (let j = 0; j < chunks.length; j++) {
        built = built.concat(chunks[j]);
        setSolutionPaths((prev) => [...prev.filter((x, idx) => idx < i), built]);
        await sleep(12);
      }
      // lock the segment at the end
      setSolutionPaths((prev) => [...prev.filter((x, idx) => idx < i), seg]);
    }
  }

  // utility: clear everything
  function clearAll() {
    setGrid(createEmptyGrid(rows, cols));
    setPoiMap({});
    setStart(null);
    setSolutionPaths([]);
    setTrialPaths([]);
  }

  // helper UI actions for POIs
  function removePoiAt(key) {
    const pm = { ...poiMap };
    delete pm[key];
    setPoiMap(pm);
    const [r, c] = key.split("_").map(Number);
    const g = createGridCopy(grid);
    if (g[r][c] === 3) g[r][c] = 0;
    setGrid(g);
  }

  return (
    <div className="p-4 font-sans">
      <h1 className="text-2xl font-bold mb-2">Network Simulator</h1>
      <div className="flex gap-4">
        <div className="flex-none p-2 border rounded w-[360px] bg-white shadow">
          <div className="mb-3">
            <label className="block text-sm">Rows</label>
            <input type="number" value={rows} onChange={(e)=>setRows(clamp(Number(e.target.value), 6, 120))} className="w-full border p-1 rounded" />
            <label className="block text-sm mt-2">Cols</label>
            <input type="number" value={cols} onChange={(e)=>setCols(clamp(Number(e.target.value), 6, 160))} className="w-full border p-1 rounded" />
            <button className="mt-2 w-full bg-gray-800 text-white py-1 rounded" onClick={()=>{setGrid(createEmptyGrid(rows,cols)); setPoiMap({}); setStart(null); setSolutionPaths([]); setTrialPaths([]);}}>Reset grid</button>
          </div>

          <div className="mb-3">
            <div className="flex gap-2">
              <button className={`py-1 px-2 rounded ${mode==='wall'? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={()=>setMode('wall')}>Draw wall</button>
              <button className={`py-1 px-2 rounded ${mode==='erase'? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={()=>setMode('erase')}>Erase</button>
              <button className={`py-1 px-2 rounded ${mode==='poi'? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={()=>setMode('poi')}>Place POI</button>
              <button className={`py-1 px-2 rounded ${mode==='start'? 'bg-indigo-600 text-white' : 'bg-gray-100'}`} onClick={()=>setMode('start')}>Place Start</button>
            </div>
            <div className="mt-2">
              <label className="block text-sm">POI size</label>
              <input type="range" min={1} max={12} value={poiSize} onChange={(e)=>setPoiSize(Number(e.target.value))} className="w-full" />
              <div className="flex items-center mt-1 gap-2">
                <input value={selectedPoiColor} onChange={(e)=>setSelectedPoiColor(e.target.value)} type="color" />
                <div className="text-sm">Current color</div>
              </div>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-sm">Simulation options</label>
            <div className="flex gap-2 mt-2">
              <label className="text-sm">Trials</label>
              <input type="number" value={trials} onChange={(e)=>setTrials(clamp(Number(e.target.value), 1, 200))} className="w-20 border p-1 rounded" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input id="showTrials" type="checkbox" checked={showTrials} onChange={(e)=>setShowTrials(e.target.checked)} />
              <label htmlFor="showTrials" className="text-sm">Show trials (low opacity)</label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <label htmlFor="trialOpacity" className="text-sm">Trial opacity</label>
              <input id="trialOpacity" type="range" min={0.02} max={0.5} step={0.02} value={trialOpacity} onChange={(e)=>setTrialOpacity(Number(e.target.value))} className="w-full" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input id="animateGrowth" type="checkbox" checked={animateGrowth} onChange={(e)=>setAnimateGrowth(e.target.checked)} />
              <label htmlFor="animateGrowth" className="text-sm">Animate growth</label>
            </div>

            <div className="mt-3 flex gap-2">
              <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={runSimulation} disabled={isSimulating}>{isSimulating? 'Simulating...' : 'Simulate'}</button>
              <button className="px-3 py-1 bg-gray-200 rounded" onClick={clearAll}>Clear</button>
            </div>
          </div>

          <div className="mb-3">
            <label className="block text-sm">POIs</label>
            <div className="max-h-40 overflow-auto mt-2">
              {Object.entries(poiMap).length===0 && <div className="text-sm text-gray-500">No POIs yet. Add by selecting "Place POI" and clicking the grid.</div>}
              {Object.entries(poiMap).map(([k,p])=> (
                <div key={k} className="flex items-center justify-between gap-2 border-b py-1">
                  <div>
                    <div className="text-sm">POI ({p.r},{p.c})</div>
                    <div className="text-xs text-gray-600">size {p.size}</div>
                  </div>
                  <div className="flex gap-1 items-center">
                    <div style={{width:18,height:18,background:p.color,borderRadius:4}}/>
                    <button className="text-xs text-red-600" onClick={()=>removePoiAt(k)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-600">How it finds the most efficient route: it combines A* (shortest-grid paths) with an MST computed on the terminals (start + POIs). POI size influences local path cost creating attraction. Trials add small noise so you can visualize plausible alternatives. Final route is deterministic.</div>
        </div>

        <div className="flex-1">
          <div className="mb-2 flex gap-2 items-center">
            <div className="text-sm">Mode: <strong>{mode}</strong></div>
            <div className="text-sm">Grid: {rows} x {cols}</div>
            <div className="ml-auto text-sm">Click grid to draw. Walls block network from going beyond map boundaries.</div>
          </div>

          <div className="border bg-white shadow">
            <canvas
              ref={canvasRef}
              style={{cursor:'crosshair'}}
              onClick={handleCanvasClick}
              onMouseDown={handlePointerDown}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------ Utilities ------------------
function createEmptyGrid(r, c) {
  const g = Array.from({ length: r }, () => Array(c).fill(0));
  return g;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function heuristic(a, b) {
  // Manhattan
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

function neighbors(r, c, rows, cols) {
  const out = [];
  if (r > 0) out.push({ r: r-1, c });
  if (r < rows-1) out.push({ r: r+1, c });
  if (c > 0) out.push({ r, c: c-1 });
  if (c < cols-1) out.push({ r, c: c+1 });
  return out;
}

function hexToRgba(hex, a=1){
  const h = hex.replace('#','');
  const bigint = parseInt(h,16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

function chunkArray(arr, size){
  const out = [];
  for (let i=0;i<arr.length;i+=size) out.push(arr.slice(i, i+size));
  return out;
}

// simple deterministic pseudo-random hash used for noise
function pseudoRandomHash(r, c, seed) {
  let x = (r * 73856093) ^ (c * 19349663) ^ (seed * 83492791);
  x = (x << 13) ^ x;
  const t = (1.0 - ((x * (x * x * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0);
  return Math.abs(t) * 0.5; // 0..0.5
}

// Minimal binary heap for A*
class MinHeap {
  constructor(cmp) { this.data = []; this.cmp = cmp; }
  push(v){ this.data.push(v); this._siftUp(this.data.length-1); }
  pop(){ if(this.data.length===0) return null; const res=this.data[0]; const last=this.data.pop(); if(this.data.length>0){ this.data[0]=last; this._siftDown(0);} return res; }
  isEmpty(){ return this.data.length===0; }
  _siftUp(i){ while(i>0){ const p = Math.floor((i-1)/2); if(this.cmp(this.data[i], this.data[p]) < 0){ [this.data[i], this.data[p]]=[this.data[p], this.data[i]]; i=p; } else break; }}
  _siftDown(i){ const n=this.data.length; while(true){ let l=2*i+1, r=2*i+2, smallest=i; if(l<n && this.cmp(this.data[l], this.data[smallest])<0) smallest=l; if(r<n && this.cmp(this.data[r], this.data[smallest])<0) smallest=r; if(smallest!==i){ [this.data[i], this.data[smallest]]=[this.data[smallest], this.data[i]]; i=smallest; } else break; }}
}

// ---- end ----
