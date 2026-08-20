import * as THREE from 'three'

/**
 * SandPuff — one shared THREE.Points pool (<= 60 particles total) for the
 * dust burst when a drink dies into the sand. Render-only: Math.random here
 * never touches physics or game state, so harness determinism is unaffected.
 * Dead particles are parked far underground instead of resizing buffers.
 */

const MAX = 60
const PER_BURST = 22
const GRAVITY = 2.2 // dust drifts, it doesn't drop like a rock
const PARK_Y = -100

export class SandPuff {
  readonly points: THREE.Points
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.PointsMaterial
  private readonly posAttr: THREE.BufferAttribute
  private readonly vel = new Float32Array(MAX * 3)
  private readonly life = new Float32Array(MAX)
  private cursor = 0

  constructor() {
    const positions = new Float32Array(MAX * 3)
    for (let i = 0; i < MAX; i++) positions[i * 3 + 1] = PARK_Y
    this.geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(positions, 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('position', this.posAttr)
    this.mat = new THREE.PointsMaterial({
      color: 0xdcc79e,
      size: 0.02,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
  }

  burst(at: THREE.Vector3): void {
    const a = this.posAttr.array as Float32Array
    for (let n = 0; n < PER_BURST; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % MAX
      const ang = Math.random() * Math.PI * 2
      const r = 0.01 + Math.random() * 0.03
      a[i * 3] = at.x + Math.cos(ang) * r
      a[i * 3 + 1] = Math.max(0.02, Math.min(at.y, 0.12))
      a[i * 3 + 2] = at.z + Math.sin(ang) * r
      const sp = 0.15 + Math.random() * 0.35
      this.vel[i * 3] = Math.cos(ang) * sp
      this.vel[i * 3 + 1] = 0.4 + Math.random() * 0.5
      this.vel[i * 3 + 2] = Math.sin(ang) * sp
      this.life[i] = 0.45 + Math.random() * 0.35
    }
    this.posAttr.needsUpdate = true
  }

  update(dt: number): void {
    if (dt <= 0) return
    const a = this.posAttr.array as Float32Array
    let any = false
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue
      this.life[i] -= dt
      any = true
      if (this.life[i] <= 0) {
        a[i * 3 + 1] = PARK_Y
        continue
      }
      this.vel[i * 3 + 1] -= GRAVITY * dt
      a[i * 3] += this.vel[i * 3] * dt
      a[i * 3 + 1] += this.vel[i * 3 + 1] * dt
      a[i * 3 + 2] += this.vel[i * 3 + 2] * dt
      if (a[i * 3 + 1] < 0.005) {
        a[i * 3 + 1] = 0.005
        this.vel[i * 3 + 1] = 0
      }
    }
    if (any) this.posAttr.needsUpdate = true
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
  }
}
