/**
 * The floor as a grid of small cells, some blocked by furniture and people. A* finds a path
 * between cells; the result is smoothed into a few straight lines.
 */
export class WalkGrid {
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(
    readonly width: number,
    readonly depth: number,
    readonly cell = 0.5,
  ) {
    this.cols = Math.round(width / cell);
    this.rows = Math.round(depth / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private ci(x: number) {
    return Math.floor((x + this.width / 2) / this.cell);
  }
  private ri(z: number) {
    return Math.floor((z + this.depth / 2) / this.cell);
  }
  centre(c: number, r: number): [number, number] {
    return [(c + 0.5) * this.cell - this.width / 2, (r + 0.5) * this.cell - this.depth / 2];
  }

  /** Block a rotated rectangle (a piece of furniture's footprint). */
  blockRect(x: number, z: number, w: number, d: number, rot = 0, pad = 0.15) {
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const hw = w / 2 + pad;
    const hd = d / 2 + pad;
    const reach = Math.hypot(hw, hd);
    for (let r = this.ri(z - reach); r <= this.ri(z + reach); r++) {
      for (let c = this.ci(x - reach); c <= this.ci(x + reach); c++) {
        if (!this.inside(c, r)) continue;
        const [cx, cz] = this.centre(c, r);
        const dx = cx - x;
        const dz = cz - z;
        // Into the rectangle's own axes
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) this.blocked[r * this.cols + c] = 1;
      }
    }
  }

  blockCircle(x: number, z: number, radius: number) {
    for (let r = this.ri(z - radius); r <= this.ri(z + radius); r++)
      for (let c = this.ci(x - radius); c <= this.ci(x + radius); c++) {
        if (!this.inside(c, r)) continue;
        const [cx, cz] = this.centre(c, r);
        if (Math.hypot(cx - x, cz - z) <= radius) this.blocked[r * this.cols + c] = 1;
      }
  }

  /** Block every cell whose centre matches (for example: outside the room's shape). */
  blockWhere(test: (x: number, z: number) => boolean) {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const [x, z] = this.centre(c, r);
        if (test(x, z)) this.blocked[r * this.cols + c] = 1;
      }
  }

  /** Keep walkers off the back and side walls (and the very front edge). */
  blockEdges(margin: number) {
    const m = Math.ceil(margin / this.cell);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) if (r < m || c < m || c >= this.cols - m || r >= this.rows - 1) this.blocked[r * this.cols + c] = 1;
  }

  private inside(c: number, r: number) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  free(x: number, z: number) {
    const c = this.ci(x);
    const r = this.ri(z);
    return this.inside(c, r) && !this.blocked[r * this.cols + c];
  }

  /** The free spot nearest to (x, z), preferring ones close to `from` when several tie. */
  nearestFree(x: number, z: number, from?: [number, number], within = 3): [number, number] | null {
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    const reach = Math.ceil(within / this.cell);
    const c0 = this.ci(x);
    const r0 = this.ri(z);
    for (let r = r0 - reach; r <= r0 + reach; r++)
      for (let c = c0 - reach; c <= c0 + reach; c++) {
        if (!this.inside(c, r) || this.blocked[r * this.cols + c]) continue;
        const [cx, cz] = this.centre(c, r);
        const d = Math.hypot(cx - x, cz - z);
        if (d > within) continue;
        const score = d * 4 + (from ? Math.hypot(cx - from[0], cz - from[1]) * 0.2 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = [cx, cz];
        }
      }
    return best;
  }

  /** Every cell reachable from a start cell (a flood fill), as a 0/1 map. */
  private reachable(from: number): Uint8Array {
    const seen = new Uint8Array(this.cols * this.rows);
    const queue = [from];
    seen[from] = 1;
    while (queue.length) {
      const cur = queue.pop()!;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (!this.inside(nc, nr)) continue;
        const ni = nr * this.cols + nc;
        if (seen[ni] || this.blocked[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    return seen;
  }

  /**
   * A* over 8 neighbours. Returns world points from just after the start to the goal, or null.
   * The goal is the reachable free spot nearest to `to`, so a target tucked behind furniture
   * still gets the player as close as they can stand.
   */
  path(from: [number, number], to: [number, number]): [number, number][] | null {
    const start = this.nearestFree(from[0], from[1], undefined, 1.5);
    if (!start) return null;
    const startCell = this.ri(start[1]) * this.cols + this.ci(start[0]);
    const reach = this.reachable(startCell);
    let goal: [number, number] | null = null;
    let best = Infinity;
    for (let i = 0; i < reach.length; i++) {
      if (!reach[i]) continue;
      const [cx, cz] = this.centre(i % this.cols, Math.floor(i / this.cols));
      const d = Math.hypot(cx - to[0], cz - to[1]) * 4 + Math.hypot(cx - from[0], cz - from[1]) * 0.2;
      if (d < best) {
        best = d;
        goal = [cx, cz];
      }
    }
    if (!goal) return null;
    // Keep an exact target when it is itself a reachable free spot.
    if (this.free(to[0], to[1]) && reach[this.ri(to[1]) * this.cols + this.ci(to[0])]) goal = to;
    const s = this.ri(start[1]) * this.cols + this.ci(start[0]);
    const g = this.ri(goal[1]) * this.cols + this.ci(goal[0]);
    const n = this.cols * this.rows;
    const gScore = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open: number[] = [s];
    const fScore = new Float32Array(n).fill(Infinity);
    const h = (i: number) => Math.hypot((i % this.cols) - (g % this.cols), Math.floor(i / this.cols) - Math.floor(g / this.cols));
    gScore[s] = 0;
    fScore[s] = h(s);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (fScore[open[k]] < fScore[open[bi]]) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === g) break;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!this.inside(nc, nr)) continue;
          const ni = nr * this.cols + nc;
          if (this.blocked[ni] || closed[ni]) continue;
          // No cutting corners past furniture
          if (dr && dc && (this.blocked[cr * this.cols + nc] || this.blocked[nr * this.cols + cc])) continue;
          const tentative = gScore[cur] + (dr && dc ? Math.SQRT2 : 1);
          if (tentative < gScore[ni]) {
            came[ni] = cur;
            gScore[ni] = tentative;
            fScore[ni] = tentative + h(ni);
            if (!open.includes(ni)) open.push(ni);
          }
        }
    }
    if (s !== g && came[g] < 0) return null;
    const cells: number[] = [];
    for (let i = g; i !== s && i >= 0; i = came[i]) cells.unshift(i);
    const pts = cells.map((i) => this.centre(i % this.cols, Math.floor(i / this.cols)));
    if (pts.length) pts[pts.length - 1] = goal;
    return this.smooth([start, ...pts]).slice(1);
  }

  /** Drop points that a straight line can skip. */
  private smooth(pts: [number, number][]): [number, number][] {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  /** Whether a straight line between two points stays on free cells. */
  clear(a: [number, number], b: [number, number]) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell * 0.4));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (!this.free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  }
}
