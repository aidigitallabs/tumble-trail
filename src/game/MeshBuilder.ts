import { BufferGeometry, Color, Float32BufferAttribute, Matrix3, Matrix4, Vector3 } from 'three';

/** Non-indexed triangle soup with flat normals and vertex colours. */
export class MeshBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  private readonly ab = new Vector3();
  private readonly ac = new Vector3();
  private readonly n = new Vector3();

  /** One triangle, wound so its geometric normal agrees with `outward` (flipped if it does not). */
  tri(a: Vector3, b: Vector3, c: Vector3, outward: Vector3, col: Color): void {
    this.ab.subVectors(b, a);
    this.ac.subVectors(c, a);
    this.n.crossVectors(this.ab, this.ac);
    if (this.n.lengthSq() < 1e-14) return; // degenerate sliver
    this.n.normalize();
    if (this.n.dot(outward) < 0) {
      this.pushTri(a, c, b, this.n.negate(), col);
    } else {
      this.pushTri(a, b, c, this.n, col);
    }
  }

  private pushTri(a: Vector3, b: Vector3, c: Vector3, n: Vector3, col: Color): void {
    for (const p of [a, b, c]) {
      this.position.push(p.x, p.y, p.z);
      this.normal.push(n.x, n.y, n.z);
      this.color.push(col.r, col.g, col.b);
    }
  }

  /** A quad p0-p1-p2-p3 (in loop order) facing `outward`. */
  quad(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, outward: Vector3, col: Color): void {
    this.tri(p0, p1, p2, outward, col);
    this.tri(p0, p2, p3, outward, col);
  }

  /**
   * An oriented box: `center`, orthonormal axes `ax`/`ay`/`az` and half extents `hx`/`hy`/`hz`
   * along them. Six outward-facing quads.
   */
  box(
    center: Vector3,
    axes: readonly [Vector3, Vector3, Vector3],
    half: readonly [number, number, number],
    col: Color,
  ): void {
    const corner = (sx: number, sy: number, sz: number): Vector3 =>
      center
        .clone()
        .addScaledVector(axes[0], sx * half[0])
        .addScaledVector(axes[1], sy * half[1])
        .addScaledVector(axes[2], sz * half[2]);
    const c = (sx: number, sy: number, sz: number): Vector3 => corner(sx, sy, sz);
    const nx = axes[0];
    const ny = axes[1];
    const nz = axes[2];
    this.quad(c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1), nx, col);
    this.quad(c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), nx.clone().negate(), col);
    this.quad(c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), ny, col);
    this.quad(c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), ny.clone().negate(), col);
    this.quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), nz, col);
    this.quad(c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1), nz.clone().negate(), col);
  }

  /**
   * Bakes a three.js primitive (indexed or not) into this builder, transformed by `matrix`,
   * flat-shaded, in one colour. Outward comes from the primitive's own vertex normals.
   */
  addGeometry(geometry: BufferGeometry, matrix: Matrix4, col: Color): void {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const index = geometry.getIndex();
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    const count = index ? index.count : pos.count;
    const at = (k: number): number => (index ? index.getX(k) : k);
    const v = [new Vector3(), new Vector3(), new Vector3()] as const;
    const outward = new Vector3();
    const tmp = new Vector3();
    for (let k = 0; k + 2 < count; k += 3) {
      outward.set(0, 0, 0);
      for (let m = 0; m < 3; m++) {
        const i = at(k + m);
        (v[m] as Vector3).fromBufferAttribute(pos, i).applyMatrix4(matrix);
        outward.add(tmp.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix));
      }
      this.tri(v[0], v[1], v[2], outward, col);
    }
  }

  get triangles(): number {
    return this.position.length / 9;
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.color, 3));
    return g;
  }
}
