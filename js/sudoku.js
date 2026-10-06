// Sudoku engine: puzzle generation and solving.
// Boards are flat arrays of 81 numbers, 0 = empty.

const ALL = 0x3fe; // bits 1..9

const ROW = [], COL = [], BOX = [], PEERS = [];
for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}
for (let i = 0; i < 81; i++) {
  const p = [];
  for (let j = 0; j < 81; j++) {
    if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) p.push(j);
  }
  PEERS[i] = p;
}

export { ROW, COL, BOX, PEERS };

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bitCount(n) {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

// Counts solutions up to `limit`. If `out` is provided, the first solution is written into it.
// When `randomize` is true, candidate digits are tried in random order (used to build full grids).
function search(board, limit, out, randomize) {
  const grid = board.slice();
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const v = grid[i];
    if (!v) continue;
    const b = 1 << v;
    if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & b) return 0; // invalid givens
    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b;
  }

  let count = 0;
  const recurse = () => {
    // Choose the empty cell with the fewest candidates.
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      const mask = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
      const c = bitCount(mask);
      if (c < bestCount) {
        best = i; bestMask = mask; bestCount = c;
        if (c <= 1) break;
      }
    }
    if (best === -1) {
      if (count === 0 && out) for (let i = 0; i < 81; i++) out[i] = grid[i];
      count++;
      return count >= limit;
    }
    if (bestCount === 0) return false;

    let digits = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    if (randomize) shuffle(digits);

    const r = ROW[best], c = COL[best], bx = BOX[best];
    for (const d of digits) {
      const b = 1 << d;
      grid[best] = d;
      rows[r] |= b; cols[c] |= b; boxes[bx] |= b;
      if (recurse()) return true;
      rows[r] &= ~b; cols[c] &= ~b; boxes[bx] &= ~b;
    }
    grid[best] = 0;
    return false;
  };
  recurse();
  return count;
}

export function solve(board) {
  const out = new Array(81).fill(0);
  return search(board, 1, out, false) ? out : null;
}

export function countSolutions(board, limit = 2) {
  return search(board, limit, null, false);
}

function fullGrid() {
  const out = new Array(81).fill(0);
  search(new Array(81).fill(0), 1, out, true);
  return out;
}

export const DIFFICULTIES = {
  easy:   { label: 'Easy',   clues: 40 },
  medium: { label: 'Medium', clues: 33 },
  hard:   { label: 'Hard',   clues: 28 },
  expert: { label: 'Expert', clues: 24 },
};

// Generates a puzzle with a unique solution. Removes cells in random
// (symmetric) pairs while the solution stays unique, until the clue target
// for the difficulty (or an explicit `clues` count) is reached or no more
// cells can be removed.
export function generate(difficulty = 'medium', clues) {
  const target = clues || (DIFFICULTIES[difficulty] || DIFFICULTIES.medium).clues;
  let best = null;

  // A few attempts; keep whichever got closest to the target.
  for (let attempt = 0; attempt < 6; attempt++) {
    const solution = fullGrid();
    const puzzle = solution.slice();
    let clues = 81;
    const order = shuffle([...Array(41).keys()]); // cell i paired with 80 - i

    for (const i of order) {
      if (clues <= target) break;
      const j = 80 - i;
      const saved = [puzzle[i], puzzle[j]];
      puzzle[i] = 0; puzzle[j] = 0;
      const removed = i === j ? 1 : 2;
      if (clues - removed < target - 1 || countSolutions(puzzle, 2) !== 1) {
        puzzle[i] = saved[0]; puzzle[j] = saved[1];
      } else {
        clues -= removed;
      }
    }

    if (!best || clues < best.clues) best = { puzzle, solution, clues };
    if (clues <= target) break;
  }

  return { puzzle: best.puzzle, solution: best.solution, difficulty };
}
