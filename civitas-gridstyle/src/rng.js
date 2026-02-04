function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seedLike) {
    const seedText = String(seedLike ?? "0");
    const seed = xmur3(seedText)();
    this._rand = mulberry32(seed);
    this._seed = seedText;
  }

  get seed() {
    return this._seed;
  }

  f32() {
    return this._rand();
  }

  int(minIncl, maxIncl) {
    const r = this.f32();
    return minIncl + (Math.floor(r * (maxIncl - minIncl + 1)) | 0);
  }

  pick(arr) {
    if (!arr.length) throw new Error("RNG.pick: empty array");
    return arr[this.int(0, arr.length - 1)];
  }

  chance(p) {
    return this.f32() < p;
  }

  shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}
