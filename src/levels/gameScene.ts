import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import type { BootCtx, SceneHandle } from '../main'
import { TABLE, SURFACE_Y } from '../config/table'
import { TIERS, type TierId } from '../config/tiers'
import { registerHarness } from '../harness/api'

/**
 * PLACEHOLDER game scene — validates boot, fixed-step physics, interpolation.
 * Replaced by the real game in milestone 2+.
 */
export async function createGameScene(ctx: BootCtx): Promise<SceneHandle> {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8fc4dd)

  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 50)
  camera.position.set(0, SURFACE_Y + 1.15, TABLE.HALF_L + 1.05)
  camera.lookAt(0, SURFACE_Y, -0.2)

  const sun = new THREE.DirectionalLight(0xfff2dd, 3)
  sun.position.set(2, 3, 1)
  sun.castShadow = true
  scene.add(sun, new THREE.AmbientLight(0xbcd8e8, 0.6))

  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.HALF_W * 2, TABLE.THICKNESS, TABLE.HALF_L * 2),
    new THREE.MeshStandardMaterial({ color: 0xa9835a, roughness: 0.8 })
  )
  plank.position.y = SURFACE_Y - TABLE.THICKNESS / 2
  plank.receiveShadow = true
  scene.add(plank)

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 120
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(TABLE.HALF_W, TABLE.THICKNESS / 2, TABLE.HALF_L)
      .setTranslation(0, SURFACE_Y - TABLE.THICKNESS / 2, 0)
  )

  interface P { body: RAPIER.RigidBody; mesh: THREE.Mesh; prev: THREE.Vector3; curr: THREE.Vector3 }
  const bodies: P[] = []

  function spawn(tier: TierId, x = 0, z = 0): number {
    const def = TIERS[tier]
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, SURFACE_Y + def.height / 2 + 0.05, z)
        .enabledRotations(false, true, false)
    )
    const col = world.createCollider(RAPIER.ColliderDesc.cylinder(def.height / 2, def.radius), body)
    col.setFriction(0.4)
    body.setAdditionalMass(def.massKg, true)
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(def.radius, def.radius, def.height, 24),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(def.hue / 360, 0.6, 0.55) })
    )
    mesh.castShadow = true
    scene.add(mesh)
    bodies.push({ body, mesh, prev: new THREE.Vector3(x, 0, z), curr: new THREE.Vector3(x, 0, z) })
    return bodies.length
  }

  spawn(3, 0, 0.6)
  spawn(6, -0.1, -0.2)
  spawn(9, 0.15, -0.5)

  registerHarness({
    spawn: (t, x, z) => spawn(t, x ?? 0, z ?? 0.6),
    push: (angle, power) => {
      const p = bodies[bodies.length - 1]
      if (!p) return
      const def = TIERS[3]
      const j = 2.35 * power * Math.pow(def.massKg, 0.62)
      p.body.applyImpulse({ x: Math.sin(angle) * -j * 0, y: 0, z: -j }, true)
    },
    stepTo: (s) => ctx.scheduler.stepTo(s),
    capture: async () => { handle.render() },
    state: () => bodies.map((p) => p.body.translation()),
  })

  const handle: SceneHandle = {
    fixedUpdate() {
      for (const p of bodies) p.prev.copy(p.curr)
      world.step()
      for (const p of bodies) {
        const t = p.body.translation()
        p.curr.set(t.x, t.y, t.z)
      }
    },
    frameUpdate(alpha) {
      for (const p of bodies) p.mesh.position.lerpVectors(p.prev, p.curr, alpha)
    },
    render() {
      ctx.renderer.render(scene, camera)
    },
    onResize(w, h) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    },
    dispose() {},
  }
  return handle
}
