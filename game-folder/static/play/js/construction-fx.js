import * as THREE from 'three';

// One manager per scene. Positions and dimensions use scene units.
// Call update(dtSeconds) before rendering; dispose() with your scene.
export function createConstructionFX(scene) {
  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const starGeometry = new THREE.OctahedronGeometry(1);
  const jobs = new Set();
  let disposed = false;
  const clamp = x => Math.max(0, Math.min(1, x));
  const smooth = x => { x = clamp(x); return x*x*(3-2*x); };
  function remove(job) {
    scene.remove(job.group);
    job.materials.forEach(m => m.dispose());
    jobs.delete(job);
  }
  return {
    play({ position, width = 1, height = 1, duration = 1.7, onSwap = () => {}, onComplete = () => {}, reducedMotion = false }) {
      if (disposed) throw new Error('Construction FX has been disposed');
      if (!(width > 0 && height > 0 && duration > 0)) throw new Error('Dimensions and duration must be positive');
      if (reducedMotion) { onSwap(); onComplete(); return { cancel() {} }; }
      const group = new THREE.Group();
      group.position.copy(position);
      const materials = [];
      const puffs = [];
      // Counter-rotating tiers interleave; individual puffs follow curved rolls.
      for (let tier = 0; tier < 3; tier++) for (let i = 0; i < 8; i++) {
        const angle = i / 8 * Math.PI * 2 + tier * .38;
        const material = new THREE.MeshStandardMaterial({ color: 0xfff2dc, roughness: 1 });
        materials.push(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        group.add(mesh);
        const phase = i * 2.39996 + tier * 1.71;
        puffs.push({ mesh, angle, tier, phase,
          speed: (tier === 1 ? -1 : 1) * (1.05 + (i % 3) * .19),
          delay: (i % 3) * .018 + tier * .025,
          radius: Math.max(width * .395, height * .25) * (.94 + .08 * Math.sin(phase)),
        });
      }
      const stars = [];
      const starMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc63 });
      materials.push(starMaterial);
      for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(starGeometry, starMaterial);
        mesh.visible = false;
        group.add(mesh); stars.push(mesh);
      }
      const job = { group, materials, puffs, stars, time: 0, swapped: false, width, height, duration, onSwap, onComplete };
      jobs.add(job); scene.add(group);
      return { cancel() { remove(job); } };
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) return;
      for (const job of [...jobs]) {
        job.time += dt;
        const t = job.time / job.duration;
        for (const p of job.puffs) {
          const grow = smooth((t - p.delay) / .2);
          const clear = smooth((t - .57 - p.delay * .3) / .36);
          const travel = Math.max(0, t - p.delay);
          const roll = p.phase + travel * (5.2 + .6 * p.tier);
          const angle = p.angle + travel * p.speed * 2.2 + .12 * Math.sin(roll);
          const radial = job.width * (.38 + .065 * Math.cos(roll) + clear * .55);
          p.mesh.position.set(
            Math.cos(angle) * radial,
            job.height * (.2 + p.tier * .3 + .085 * Math.sin(roll)) + clear * job.height * .35,
            Math.sin(angle) * radial,
          );
          const s = p.radius * grow * (1 - clear);
          // An asymmetric silhouette makes the rotation visible without pulsating.
          p.mesh.rotation.set(roll * .7, angle, roll * p.speed * .65);
          p.mesh.scale.set(s * 1.1, s * .94, s);
          p.mesh.visible = s > .001;
        }
        // Synchronous callback: prepare the new object before calling play().
        if (!job.swapped && t >= .43) { job.swapped = true; job.onSwap(); }
        const sparkle = clamp((t - .7) / .3);
        job.stars.forEach((star, i) => {
          const a = i * Math.PI * 2 / 5;
          star.position.set(Math.cos(a) * job.width * (.55 + sparkle * .3), job.height * (.8 + sparkle * .55), Math.sin(a) * job.width * (.55 + sparkle * .3));
          star.rotation.y = sparkle * 3;
          const s = Math.sin(sparkle * Math.PI) * job.width * .1;
          star.scale.set(s, s * 1.8, s); star.visible = s > .001;
        });
        if (t >= 1) { remove(job); job.onComplete(); }
      }
    },
    get activeCount() { return jobs.size; },
    dispose() { for (const job of [...jobs]) remove(job); geometry.dispose(); starGeometry.dispose(); disposed = true; },
  };
}
